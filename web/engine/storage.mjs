// Cache bodies are compressed explicitly; Content-Encoding would imply network decoding.
const ENCODING='x-rhf-storage',SIZE='x-rhf-original-size';
const root=new URL('../',import.meta.url),REFERENCE='x-rhf-blob';
export const blobCacheName='rhf-blobs:'+root.pathname+':v1';
export async function storeAsset(cache,url,response){
 const original=await response.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',original)),n=>n.toString(16).padStart(2,'0')).join('');
 const blobs=await caches.open(blobCacheName),key=new URL('stored-assets/'+hash,root);
 let packed=await blobs.match(key);
 if(!packed){packed=await packAsset(new Response(original,{headers:response.headers}));await blobs.put(key,packed.clone());}
 const headers=new Headers({'content-type':response.headers.get('content-type')||'application/octet-stream',[REFERENCE]:hash,[SIZE]:String(original.byteLength)});
 await cache.put(url,new Response(null,{headers}));
 return {hash,rawBytes:original.byteLength,bytes:(await packed.arrayBuffer()).byteLength};
}
export async function readStoredAsset(response){
 const hash=response.headers.get(REFERENCE);
 if(hash){
  if(!/^[a-f0-9]{64}$/.test(hash))throw new Error('Invalid local game data reference. Prepare this game again.');
  const blob=await(await caches.open(blobCacheName)).match(new URL('stored-assets/'+hash,root));
  if(!blob)throw new Error('Local game data is incomplete. Prepare this game again from your disc.');
  // Two identical bodies can have different MIME types; the per-file header owns it.
  const headers=new Headers(blob.headers);headers.set('content-type',response.headers.get('content-type')||'application/octet-stream');
  return unpackAsset(new Response(blob.body,{headers}));
 }
 return unpackAsset(response);
}
export async function packAsset(response){
 if(response.headers.has(ENCODING)||typeof CompressionStream==='undefined')return response;
 const type=response.headers.get('content-type')||'';
 if(/image\//.test(type))return response;
 const data=await response.arrayBuffer();
 if(data.byteLength<1024)return new Response(data,{headers:response.headers});
 const packed=await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
 const headers=new Headers(response.headers);
 if(packed.byteLength+64>=data.byteLength)return new Response(data,{headers});
 headers.set(ENCODING,'gzip');headers.set(SIZE,String(data.byteLength));headers.delete('content-length');
 return new Response(packed,{headers});
}
export function unpackAsset(response){
 const encoding=response.headers.get(ENCODING);
 if(!encoding)return response;
 if(encoding!=='gzip'||typeof DecompressionStream==='undefined')throw new Error('This browser cannot read compressed game data. Use a current desktop browser.');
 const headers=new Headers(response.headers);headers.delete(ENCODING);headers.delete(SIZE);headers.delete('content-length');
 return new Response(response.body.pipeThrough(new DecompressionStream('gzip')),{headers});
}
export async function assetSizes(response){
 const bytes=(await response.clone().arrayBuffer()).byteLength;
 return {bytes,rawBytes:Number(response.headers.get(SIZE))||bytes};
}
