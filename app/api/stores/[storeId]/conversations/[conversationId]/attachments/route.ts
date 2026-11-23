import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";
import { createPrivateUploadUrl } from "@/lib/media/storage";
import { mediaPolicyForMimeType, sanitizeMediaFileName } from "@/lib/media/validation";
export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{storeId:string;conversationId:string}>};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request:Request,context:Context) {
  const user=await getRequestUser();
  if(!user)return NextResponse.json({error:"Sign in required"},{status:401});
  const {storeId,conversationId}=await context.params;
  if(!UUID.test(storeId)||!UUID.test(conversationId))return NextResponse.json({error:"Invalid store or conversation identifier"},{status:400});
  let body:Record<string,unknown>;
  try{body=await request.json()}catch{return NextResponse.json({error:"Invalid request body"},{status:400})}
  const messageId=typeof body.messageId==="string"?body.messageId:"";
  const mimeType=typeof body.mimeType==="string"?body.mimeType.toLowerCase():"";
  const fileName=typeof body.fileName==="string"?sanitizeMediaFileName(body.fileName):"attachment";
  const byteSize=Number(body.byteSize);
  const media=mediaPolicyForMimeType(mimeType);
  if(!UUID.test(messageId)||!media||!Number.isSafeInteger(byteSize)||byteSize<1||byteSize>media.maxBytes){
    return NextResponse.json({error:"A valid messageId, supported MIME type and permitted file size are required."},{status:400});
  }
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id',$1,true)",[user.id]);
    const membership=await client.query("SELECT 1 FROM store_memberships WHERE store_id=$1 AND user_id=$2",[storeId,user.id]);
    if(!membership.rowCount){await client.query("ROLLBACK");return NextResponse.json({error:"Store membership required"},{status:403})}
    const message=await client.query("SELECT 1 FROM conversation_messages WHERE store_id=$1 AND conversation_id=$2 AND id=$3",[storeId,conversationId,messageId]);
    if(!message.rowCount){await client.query("ROLLBACK");return NextResponse.json({error:"Message not found in this conversation"},{status:404})}
    const attachmentId=randomUUID();
    const storageKey="staging/stores/"+storeId+"/conversations/"+conversationId+"/"+attachmentId+"."+media.extension;
    await client.query("INSERT INTO conversation_attachments (id,store_id,message_id,storage_key,mime_type,file_name,byte_size,scan_status) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')",[attachmentId,storeId,messageId,storageKey,mimeType,fileName,byteSize]);
    await client.query("COMMIT");
    try{
      const uploadUrl=await createPrivateUploadUrl({key:storageKey,contentType:mimeType});
      return NextResponse.json({attachment:{id:attachmentId,status:"pending"},uploadUrl,uploadHeaders:{"Content-Type":mimeType},expiresIn:300},{status:201,headers:{"Cache-Control":"no-store"}});
    }catch{
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.user_id',$1,true)",[user.id]);
      await client.query("DELETE FROM conversation_attachments WHERE store_id=$1 AND id=$2 AND scan_status='pending'",[storeId,attachmentId]);
      await client.query("COMMIT");
      return NextResponse.json({error:"Private media storage is not configured."},{status:503});
    }
  }catch{
    await client.query("ROLLBACK").catch(()=>undefined);
    return NextResponse.json({error:"Could not create the attachment upload."},{status:500});
  }finally{client.release()}
}
