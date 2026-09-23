"use client";

import { useEffect, useRef, useState } from 'react';
import { Camera, LoaderCircle, RotateCcw } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';

/** Camera access starts only after the person chooses “Tirar foto”. */
export function ChatCamera({onClose,onPhoto}:{onClose:()=>void;onPhoto:(file:File)=>void}) {
  const video=useRef<HTMLVideoElement>(null);
  const nativeInput=useRef<HTMLInputElement>(null);
  const stream=useRef<MediaStream|null>(null);
  const [error,setError]=useState('');
  const [ready,setReady]=useState(false);
  const [photo,setPhoto]=useState<{file:File;url:string}|null>(null);
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let cancelled=false;
    async function start() {
      try {
        if(!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
        const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1440}},audio:false});
        if(cancelled) {media.getTracks().forEach(track=>track.stop());return;}
        stream.current=media;
        if(video.current) {video.current.srcObject=media;await video.current.play();}
      } catch(cause) {
        if(cancelled) return;
        stream.current?.getTracks().forEach(track=>track.stop());
        stream.current=null;
        setError(cause instanceof DOMException && cause.name==='NotAllowedError'
          ? 'O acesso à câmera foi negado. Libere a câmera nas permissões do navegador ou escolha uma foto.'
          : 'Não foi possível abrir a câmera. Você ainda pode escolher uma foto do dispositivo.');
      }
    }
    void start();
    return ()=>{cancelled=true;stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;};
  },[attempt]);
  useEffect(()=>()=>{if(photo) URL.revokeObjectURL(photo.url);},[photo]);

  async function capture() {
    if(!video.current?.videoWidth) return;
    const canvas=document.createElement('canvas');
    const scale=Math.min(1,1920/Math.max(video.current.videoWidth,video.current.videoHeight));
    canvas.width=Math.round(video.current.videoWidth*scale);
    canvas.height=Math.round(video.current.videoHeight*scale);
    canvas.getContext('2d')!.drawImage(video.current,0,0,canvas.width,canvas.height);
    const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',0.9));
    if(!blob) {setError('Não foi possível capturar a foto. Tente novamente.');return;}
    stream.current?.getTracks().forEach(track=>track.stop());
    const file=new File([blob],`foto-${new Date().toISOString().replace(/[:.]/g,'-')}.jpg`,{type:'image/jpeg'});
    setPhoto({file,url:URL.createObjectURL(file)});
  }
  return <Dialog open onOpenChange={open=>{if(!open) onClose();}}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>Tirar foto</DialogTitle><DialogDescription>Enquadre o que deseja enviar ao Lume. A foto será anexada à sua mensagem.</DialogDescription></DialogHeader>
      <div className="relative flex min-h-40 items-center justify-center overflow-hidden rounded-xl bg-muted">
        {photo ? <img src={photo.url} alt="Foto capturada para conferir antes de anexar" className="max-h-[52dvh] w-full object-contain" /> /* eslint-disable-line @next/next/no-img-element */
          : <video ref={video} autoPlay muted playsInline onLoadedData={()=>setReady(true)} className="max-h-[52dvh] w-full object-contain" aria-label="Prévia da câmera" />}
        {!photo&&!ready&&!error&&<LoaderCircle aria-label="Abrindo câmera" className="absolute size-6 animate-spin motion-reduce:animate-none" />}
      </div>
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
      <input ref={nativeInput} type="file" accept="image/*" capture="environment" aria-label="Foto do dispositivo" className="sr-only" onChange={event=>{const file=event.target.files?.[0];if(file){onPhoto(file);onClose();}}} />
      <div className="flex flex-wrap justify-end gap-2">
        {photo ? <><Button variant="outline" onClick={()=>{setPhoto(null);setReady(false);setError('');setAttempt(value=>value+1);}}><RotateCcw />Tirar outra</Button><Button onClick={()=>{onPhoto(photo.file);onClose();}}>Anexar foto</Button></>
          : <><Button variant="outline" onClick={()=>nativeInput.current?.click()}>Escolher foto</Button><Button disabled={!ready||!!error} onClick={()=>void capture()}><Camera />Capturar</Button></>}
      </div>
    </DialogContent>
  </Dialog>;
}
