import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";
import { createPrivateDownloadUrl } from "@/lib/media/storage";
export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{storeId:string;conversationId:string;attachmentId:string}>};
export async function GET(_request:Request,context:Context) {
  const user=await getRequestUser();
  if(!user)return NextResponse.json({error:"Sign in required"},{status:401});
  const {storeId,conversationId,attachmentId}=await context.params,client=await db.connect();
  try {
    await client.query("BEGIN"); await client.query("SELECT set_config('app.user_id',$1,true)",[user.id]);
    const membership=await client.query("SELECT 1 FROM store_memberships WHERE store_id=$1 AND user_id=$2",[storeId,user.id]);
    if(!membership.rowCount){await client.query("ROLLBACK");return NextResponse.json({error:"Store membership required"},{status:403})}
    const result=await client.query("SELECT a.storage_key,a.mime_type,a.file_name,a.scan_status FROM conversation_attachments a JOIN conversation_messages m ON m.store_id=a.store_id AND m.id=a.message_id WHERE a.store_id=$1 AND m.conversation_id=$2 AND a.id=$3 LIMIT 1",[storeId,conversationId,attachmentId]);
    await client.query("COMMIT");
    if(!result.rowCount)return NextResponse.json({error:"Attachment not found"},{status:404});
    const attachment=result.rows[0];
    if(attachment.scan_status!=="available")return NextResponse.json({error:"Attachment is not available until malware scanning has approved it.",status:attachment.scan_status},{status:423});
    const url=await createPrivateDownloadUrl({key:String(attachment.storage_key),contentType:String(attachment.mime_type),fileName:String(attachment.file_name||"attachment")});
    return NextResponse.json({url,expiresIn:60},{headers:{"Cache-Control":"no-store",Pragma:"no-cache"}});
  }catch{await client.query("ROLLBACK").catch(()=>undefined);return NextResponse.json({error:"Could not authorize attachment download."},{status:500})}finally{client.release()}
}
