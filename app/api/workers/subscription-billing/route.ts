import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processSubscriptionDunningBatch } from "@/lib/subscription-dunning";
import { processQueuedBillingEmails } from "@/lib/billing-email-outbox";
import { processQueuedMerchantEmails } from "@/lib/merchant-email-worker";
import { processQueuedSmsBatch } from "@/lib/message-outbox";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request:Request) {
  const expected=process.env.COMMERCE_BILLING_WORKER_TOKEN || "";
  const received=request.headers.get("authorization") || "";
  const a=Buffer.from("Bearer "+expected);
  const b=Buffer.from(received);
  return expected.length>=32 && a.length===b.length && timingSafeEqual(a,b);
}

export async function POST(request:Request) {
  if(!authorized(request)) return NextResponse.json({error:"Unauthorized worker request"},{status:401});
  try {
    const dunning=await processSubscriptionDunningBatch(50);
    const [email,sms]=await Promise.all([
      processQueuedBillingEmails(20),
      processQueuedSmsBatch(20),
    ]);
    return NextResponse.json({ok:true,dunning,email,sms},{headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    const code=error instanceof Error ? error.message.slice(0,160) : "billing_worker_failed";
    return NextResponse.json({error:"Subscription billing worker failed",code},{status:500});
  }
}
