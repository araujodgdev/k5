import 'server-only';
import { ApiError, limitedBlob, limitedFormData } from '@/lib/workspace-api';
import { MAX_UPLOAD_BYTES } from '@/lib/vault-upload-contract';
import { validatedFileName } from '@/lib/application/uploads-service';

export async function vaultUploadForm(request: Request): Promise<FormData> {
  const encodedName = request.headers.get('x-k5-file-name');
  if (encodedName === null) return limitedFormData(request, MAX_UPLOAD_BYTES + 64_000);
  let name: string;
  try { name = decodeURIComponent(encodedName); }
  catch { throw new ApiError(400, 'O nome do arquivo é inválido.'); }
  const { mimeType } = validatedFileName(name);
  const file = new File([await limitedBlob(request, MAX_UPLOAD_BYTES)], name, { type: mimeType });
  const form = new FormData();
  form.set('file', file);
  for (const field of ['scope', 'caseId', 'folderId']) {
    const value = request.headers.get(`x-k5-upload-${field.toLowerCase()}`);
    if (value !== null) form.set(field, value);
  }
  return form;
}
