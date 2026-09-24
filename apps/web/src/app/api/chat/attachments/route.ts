import { apiWorkspace,apiError,ApiError } from '@/lib/workspace-api';
import { createChatAttachment } from '@/lib/chat-attachments';
import { MAX_CHAT_FILE_BYTES } from '@/lib/chat-attachment-contract';

export async function POST(request:Request) {
  try {
    const {user,office}=await apiWorkspace(request,true);
    const reader=request.body?.getReader();
    if(!reader) throw new ApiError(400,'Escolha um arquivo.');
    const chunks:Uint8Array[]=[];
    let size=0;
    while(true) {
      const {done,value}=await reader.read();
      if(done) break;
      size+=value.byteLength;
      if(size>MAX_CHAT_FILE_BYTES+64_000) {await reader.cancel();throw new ApiError(413,'O arquivo excede 25 MB.');}
      chunks.push(value);
    }
    const form=await new Response(Buffer.concat(chunks),{headers:{'content-type':request.headers.get('content-type')??''}}).formData();
    const file=form.get('file');
    const conversationId=form.get('conversationId');
    if(!(file instanceof File)||typeof conversationId!=='string') throw new ApiError(400,'Escolha um arquivo e uma conversa.');
    const attachment=await createChatAttachment({officeId:office.officeId,userId:user.id},conversationId,file);
    return Response.json({attachment},{status:201});
  } catch(error) {return apiError(error);}
}
