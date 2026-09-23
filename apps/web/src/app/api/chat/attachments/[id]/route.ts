import { apiWorkspace,apiError,ApiError } from '@/lib/workspace-api';
import { ownedChatAttachment,removeChatAttachment } from '@/lib/chat-attachments';
import { objectStorage } from '@/lib/storage';
type Context={params:Promise<{id:string}>};

export async function GET(request:Request,context:Context) {
  try {
    const {user,office}=await apiWorkspace(request);
    const row=await ownedChatAttachment({officeId:office.officeId,userId:user.id},(await context.params).id);
    if(!row) throw new ApiError(404,'Anexo não encontrado.');
    const bytes=await (await objectStorage()).get(row.storage_key);
    const disposition=row.media_type.startsWith('image/')?'inline':'attachment';
    return new Response(new Uint8Array(bytes),{headers:{'content-type':row.media_type,'cache-control':'private, no-store','x-content-type-options':'nosniff',
      'content-disposition':`${disposition}; filename*=UTF-8''${encodeURIComponent(row.name).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16)}`)}`}});
  } catch(error) {return apiError(error);}
}
export async function DELETE(request:Request,context:Context) {
  try {
    const {user,office}=await apiWorkspace(request,true);
    await removeChatAttachment({officeId:office.officeId,userId:user.id},(await context.params).id);
    return new Response(null,{status:204});
  } catch(error) {return apiError(error);}
}
