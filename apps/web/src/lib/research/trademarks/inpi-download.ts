/** Large INPI CSV responses can end early. Publish a range only after all its bytes validate. */
export async function* downloadInpiCsv(url: string, metadata: {size:number;etag:string}) {
  const chunkSize=8*1024*1024;
  for(let start=0;start<metadata.size;start+=chunkSize) {
    const end=Math.min(start+chunkSize,metadata.size)-1;
    let complete=false;
    for(let attempt=0;attempt<3;attempt++) {
      try {
        const response=await fetch(url,{headers:{Range:`bytes=${start}-${end}`,'If-Range':metadata.etag},signal:AbortSignal.timeout(120_000)});
        if(response.status!==206 || response.headers.get('content-range')!==`bytes ${start}-${end}/${metadata.size}` || response.headers.get('etag')!==metadata.etag) throw new Error('A carga do INPI mudou durante o download.');
        const bytes=new Uint8Array(await response.arrayBuffer());
        if(bytes.length!==end-start+1) throw new Error('Trecho incompleto dos dados abertos.');
        yield bytes;complete=true;break;
      } catch(error) {if(attempt===2)throw error;}
    }
    if(!complete) throw new Error('Download INPI interrompido.');
  }
}
