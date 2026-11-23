import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";
import { copyPrivateObject, deletePrivateObject, getPrivateObjectSize, readPrivateObject } from "@/lib/media/storage";
import { validateMediaUpload } from "@/lib/media/validation";
import { scanMediaObject } from "@/lib/media/scanner";
export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{storeId:string;conversationId:string;attachmentId:string}>};
type Attachment={storage_key:string;mime_type:string;file_name:string;byte_size:number;scan_status:string};
async function updateAttachment(userId:string,storeId:string,attachmentId:string,values:{status:"available"|"rejected"|"quarantined";sha256:string|null;mimeType:string|null;storageKey?:string}) {
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id',$1,true)",[userId]);
    await client.query("UPDATE conversation_attachments SET storage_key=COALESCE($1,storage_key),detected_mime_type=$2,sha256=$3,scan_status=$4,scanned_at=CASE WHEN $4 IN ('available','rejected') THEN now() ELSE NULL END,updated_at=now() WHERE store_id=$5 AND id=$6 AND scan_status IN ('pending','quarantined')",[values.storageKey||null,values.mimeType,values.sha256,values.status,storeId,attachmentId]);
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error}finally{client.release()}
}
export async function POST(_request:Request,context:Context){
  const user=await getRequestUser();
  if(!user)return NextResponse.json({error:"Sign in required"},{status:401});
  const {storeId,conversationId,attachmentId}=await context.params,client=await db.connect();
  let attachment:Attachment|undefined;
  try{
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id',$1,true)",[user.id]);
    const membership=await client.query("SELECT 1 FROM store_memberships WHERE store_id=$1 AND user_id=$2",[storeId,user.id]);
    if(!membership.rowCount){await client.query("ROLLBACK");return NextResponse.json({error:"Store membership required"},{status:403})}
    const result=await client.query("SELECT a.storage_key,a.mime_type,a.file_name,a.byte_size,a.scan_status FROM conversation_attachments a JOIN conversation_messages m ON m.store_id=a.store_id AND m.id=a.message_id WHERE a.store_id=$1 AND m.conversation_id=$2 AND a.id=$3 LIMIT 1",[storeId,conversationId,attachmentId]);
    const row=result.rows[0] as Attachment | undefined;
    if(!row){await client.query("ROLLBACK");return NextResponse.json({error:"Attachment not found"},{status:404})}
    attachment=row;
    if(!["pending","quarantined"].includes(row.scan_status)){await client.query("ROLLBACK");return NextResponse.json({error:"Attachment is not awaiting verification",status:row.scan_status},{status:409})}
    await client.query("COMMIT");
  }catch{await client.query("ROLLBACK").catch(()=>undefined);return NextResponse.json({error:"Could not authorize attachment verification"},{status:500})}finally{client.release()}
  if(!attachment)return NextResponse.json({error:"Attachment not found"},{status:404});
  let bytes:Buffer;
  try{
    const size=await getPrivateObjectSize(attachment.storage_key);
    if(size!==Number(attachment.byte_size))return NextResponse.json({error:"Uploaded object is missing or its size does not match the upload reservation."},{status:409});
    bytes=await readPrivateObject(attachment.storage_key);
  }catch{return NextResponse.json({error:"Uploaded object is not available in private media storage yet."},{status:409})}
  const validation=validateMediaUpload({bytes,declaredMimeType:attachment.mime_type,fileName:attachment.file_name});
  if(!validation.ok){
    await deletePrivateObject(attachment.storage_key).catch(()=>undefined);
    await updateAttachment(user.id,storeId,attachmentId,{status:"rejected",sha256:null,mimeType:null}).catch(()=>undefined);
    return NextResponse.json({error:validation.error},{status:422});
  }
  const status=await scanMediaObject({bytes,mimeType:validation.media.mimeType,sha256:validation.sha256,scannerProvider:process.env.MEDIA_SCANNER_PROVIDER,scannerUrl:process.env.MEDIA_SCANNER_URL,scannerToken:process.env.MEDIA_SCANNER_TOKEN});
  if(status==="available"){
    if(!attachment.storage_key.startsWith("staging/"))return NextResponse.json({error:"Attachment staging key is invalid."},{status:409});
    const finalKey=attachment.storage_key.replace(/^staging\//,"");
    try{await copyPrivateObject({sourceKey:attachment.storage_key,destinationKey:finalKey})}
    catch{return NextResponse.json({error:"Media was scanned but could not be promoted to private final storage. Retry verification."},{status:503})}
    try{await updateAttachment(user.id,storeId,attachmentId,{status,sha256:validation.sha256,mimeType:validation.media.mimeType,storageKey:finalKey})}
    catch{await deletePrivateObject(finalKey).catch(()=>undefined);return NextResponse.json({error:"Could not finalize attachment metadata. Retry verification."},{status:503})}
    await deletePrivateObject(attachment.storage_key).catch(()=>undefined);
  }else{
    await updateAttachment(user.id,storeId,attachmentId,{status,sha256:validation.sha256,mimeType:validation.media.mimeType}).catch(()=>undefined);
    if(status==="rejected")await deletePrivateObject(attachment.storage_key).catch(()=>undefined);
  }
  return NextResponse.json({attachmentId,status,sha256:validation.sha256},{status:status==="available"?200:202,headers:{"Cache-Control":"no-store"}});
}
