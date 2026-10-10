import { apiWorkspace,apiError,ApiError,limitedFormData } from '@/lib/workspace-api';
import { createChatAttachment } from '@/lib/chat-attachments';
import { MAX_CHAT_FILE_BYTES } from '@/lib/chat-attachment-contract';

export async function POST(request:Request) {
  try {
    const {user,office}=await apiWorkspace(request,true);
    const form=await limitedFormData(request,MAX_CHAT_FILE_BYTES+64_000);
    const file=form.get('file');
    const conversationId=form.get('conversationId');
    if(!(file instanceof File)||typeof conversationId!=='string') throw new ApiError(400,'Escolha um arquivo e uma conversa.');
    const attachment=await createChatAttachment({officeId:office.officeId,userId:user.id},conversationId,file);
    return Response.json({attachment},{status:201});
  } catch(error) {return apiError(error);}
}
