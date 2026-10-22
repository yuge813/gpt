const configured = import.meta.env.VITE_API_BASE as string | undefined
let base = configured || '/api'
// #ifndef H5
base = configured || 'http://127.0.0.1:3001/api'
// #endif
export class ApiError extends Error { constructor(message:string,public status:number){super(message)} }
export async function request<T=any>(path:string,method:'GET'|'POST'='GET',data?:Record<string,unknown>,adminToken?:string):Promise<T>{
  const token=uni.getStorageSync('aurora-token')
  return new Promise((resolve,reject)=>uni.request({url:base+path,method,data,header:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...(adminToken?{'X-Admin-Token':adminToken}:{})},success(r){
    const value=r.data as any
    if(r.statusCode>=200&&r.statusCode<300)resolve(value)
    else {if(r.statusCode===401&&!adminToken)uni.removeStorageSync('aurora-token');reject(new ApiError(value?.message||'请求失败，请稍后重试',r.statusCode))}
  },fail(){reject(new Error('连接失败，请检查网络或 API 服务'))}}))
}
export function idempotencyKey(){return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`}
