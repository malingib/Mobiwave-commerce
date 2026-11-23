import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";
import { decryptCredential } from "@/lib/mpesa-config";
import { formatDarajaTimestamp, normalizeKenyanPhone } from "@/lib/mpesa-utils";

export const runtime = "nodejs";
type Context = { params: Promise<{ storeId: string }> };

export async function POST(request: Request, context: Context) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const {storeId}=await context.params;
  const idempotencyKey=request.headers.get("idempotency-key")?.trim()||"";
  if(idempotencyKey.length<16||idempotencyKey.length>128||!/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) {
    return NextResponse.json({error:"A valid Idempotency-Key header is required."},{status:400});
  }
  let body:{amountMinor?:unknown;phone?:unknown};
  try{body=await request.json();}catch{return NextResponse.json({error:"Invalid request body"},{status:400});}
  const amountMinor=Number(body.amountMinor);
  if(!Number.isSafeInteger(amountMinor)||amountMinor<100||amountMinor%100!==0||typeof body.phone!=="string") {
    return NextResponse.json({error:"Enter a top-up amount of at least KES 1 in whole shillings and a valid M-Pesa phone number."},{status:400});
  }
  const phone=normalizeKenyanPhone(body.phone);
  if(!phone)return NextResponse.json({error:"Enter a valid Kenyan mobile number."},{status:400});
  const fingerprint=createHash("sha256").update(JSON.stringify({amountMinor,phone})).digest("hex");
  const callbackToken=process.env.MPESA_CALLBACK_TOKEN;
  const appUrl=process.env.NEXT_PUBLIC_APP_URL;
  if(!callbackToken||!appUrl)return NextResponse.json({error:"Platform M-Pesa callback settings are incomplete."},{status:503});

  const client=await db.connect();
  let attemptId:string|null=null;
  let stkRequestStarted=false;
  let consumerKey="";
  let consumerSecret="";
  let shortcode="";
  let passkey="";
  let environment:"sandbox"|"production"="sandbox";
  let transactionType:"CustomerPayBillOnline"|"CustomerBuyGoodsOnline"="CustomerPayBillOnline";
  let checkoutRequestId:string|null=null;
  let merchantRequestId:string|null=null;
  try{
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id',$1,true)",[user.id]);
    await client.query("SELECT set_config('app.wallet_topup','true',true)");
    const member=await client.query(
      "SELECT role FROM store_memberships WHERE store_id=$1 AND user_id=$2 AND role='owner'",
      [storeId,user.id],
    );
    if(!member.rowCount){
      await client.query("ROLLBACK");
      return NextResponse.json({error:"Only the store owner can top up this wallet."},{status:403});
    }
    const existing=await client.query(
      "SELECT id,amount_minor,status,checkout_request_id,idempotency_hash FROM wallet_topup_attempts WHERE store_id=$1 AND idempotency_key=$2",
      [storeId,idempotencyKey],
    );
    if(existing.rowCount){
      const previous=existing.rows[0];
      await client.query("ROLLBACK");
      if(previous.idempotency_hash!==fingerprint)return NextResponse.json({error:"This Idempotency-Key was already used for different top-up details."},{status:409});
      return NextResponse.json({message:"This wallet top-up request was already received.",status:previous.status,checkoutRequestId:previous.checkout_request_id},{status:200});
    }
    const pending=await client.query(
      "SELECT id FROM wallet_topup_attempts WHERE store_id=$1 AND status IN ('pending','review_required') LIMIT 1 FOR UPDATE",
      [storeId],
    );
    if(pending.rowCount){
      await client.query("ROLLBACK");
      return NextResponse.json({error:"A wallet top-up is pending or under reconciliation. Resolve it before starting another."},{status:409});
    }
    const configResult=await client.query(
      "SELECT consumer_key_ciphertext,consumer_secret_ciphertext,shortcode,passkey_ciphertext,environment,transaction_type,enabled FROM mpesa_configurations WHERE scope_type='platform' AND store_id IS NULL LIMIT 1",
    );
    if(!configResult.rowCount||!configResult.rows[0].enabled){
      await client.query("ROLLBACK");
      return NextResponse.json({error:"Platform M-Pesa payments are not enabled yet."},{status:503});
    }
    const config=configResult.rows[0];
    try{
      consumerKey=decryptCredential(config.consumer_key_ciphertext);
      consumerSecret=decryptCredential(config.consumer_secret_ciphertext);
      shortcode=config.shortcode;
      passkey=decryptCredential(config.passkey_ciphertext);
      environment=config.environment;
      transactionType=config.transaction_type;
    }catch{
      await client.query("ROLLBACK");
      return NextResponse.json({error:"Platform M-Pesa credentials could not be decrypted."},{status:503});
    }
    const inserted=await client.query(
      "INSERT INTO wallet_topup_attempts (store_id,status,amount_minor,currency,customer_phone,idempotency_key,idempotency_hash) VALUES ($1,'pending',$2,'KES',$3,$4,$5) RETURNING id",
      [storeId,amountMinor,phone,idempotencyKey,fingerprint],
    );
    attemptId=inserted.rows[0].id;
    await client.query("COMMIT");

    const baseUrl=environment==="production"?"https://api.safaricom.co.ke":"https://sandbox.safaricom.co.ke";
    const authResponse=await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,{
      headers:{Authorization:`Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}`},
      cache:"no-store",signal:AbortSignal.timeout(10_000),
    });
    if(!authResponse.ok)throw new Error("M-Pesa authentication failed");
    const authData=await authResponse.json() as {access_token?:string};
    if(!authData.access_token)throw new Error("M-Pesa did not return an access token");
    const time=formatDarajaTimestamp();
    const password=Buffer.from(`${shortcode}${passkey}${time}`).toString("base64");
    stkRequestStarted=true;
    const stkResponse=await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`,{
      method:"POST",
      headers:{Authorization:`Bearer ${authData.access_token}`,"Content-Type":"application/json"},
      body:JSON.stringify({
        BusinessShortCode:shortcode,Password:password,Timestamp:time,TransactionType:transactionType,
        Amount:amountMinor/100,PartyA:phone,PartyB:shortcode,PhoneNumber:phone,
        CallBackURL:`${appUrl.replace(/\/$/,"")}/api/payments/mpesa/callback?token=${encodeURIComponent(callbackToken)}`,
        AccountReference:`MW-${storeId.replace(/-/g,"").slice(0,8).toUpperCase()}`,
        TransactionDesc:"MW Wallet",
      }),
      cache:"no-store",signal:AbortSignal.timeout(15_000),
    });
    const stkData=await stkResponse.json() as {CheckoutRequestID?:string;MerchantRequestID?:string;ResponseCode?:string;ResponseDescription?:string;errorMessage?:string};
    if(!stkResponse.ok||stkData.ResponseCode!=="0"||!stkData.CheckoutRequestID)throw new Error(stkData.errorMessage||stkData.ResponseDescription||"M-Pesa rejected the STK request");
    checkoutRequestId=stkData.CheckoutRequestID;
    merchantRequestId=stkData.MerchantRequestID||null;
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id',$1,true)",[user.id]);
    await client.query("SELECT set_config('app.wallet_topup','true',true)");
    await client.query(
      "UPDATE wallet_topup_attempts SET checkout_request_id=$1,merchant_request_id=$2,updated_at=now() WHERE id=$3 AND store_id=$4",
      [checkoutRequestId,merchantRequestId,attemptId,storeId],
    );
    await client.query("COMMIT");
    return NextResponse.json({message:"M-Pesa STK Push sent. Approve the wallet top-up on your phone.",checkoutRequestId});
  }catch(error){
    await client.query("ROLLBACK").catch(()=>undefined);
    if(attemptId){
      try{
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.user_id',$1,true)",[user.id]);
        await client.query("SELECT set_config('app.wallet_topup','true',true)");
        const status=stkRequestStarted?"review_required":"failed";
        await client.query(
          "UPDATE wallet_topup_attempts SET status=$1,checkout_request_id=COALESCE($2,checkout_request_id),merchant_request_id=COALESCE($3,merchant_request_id),updated_at=now() WHERE id=$4 AND store_id=$5 AND status<>'paid'",
          [status,checkoutRequestId,merchantRequestId,attemptId,storeId],
        );
        await client.query("COMMIT");
      }catch{await client.query("ROLLBACK").catch(()=>undefined);}
    }
    const message=error instanceof Error?error.message:"Wallet top-up failed";
    return NextResponse.json({error:process.env.NODE_ENV==="production"?"Wallet top-up failed. Check provider configuration and try again.":message},{status:502});
  }finally{client.release();}
}
