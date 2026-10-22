import { defineConfig, loadEnv } from 'vite'
import uniModule from '@dcloudio/vite-plugin-uni'
const uni = (uniModule as any).default || uniModule
export default defineConfig(({mode})=>{
  const env=loadEnv(mode,process.cwd(),'')
  const apiPort=Number(process.env.PORT||env.PORT||3001)
  const frontendPort=Number(process.env.FRONTEND_PORT||env.FRONTEND_PORT||5173)
  for(const port of [apiPort,frontendPort])if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT / FRONTEND_PORT 必须是有效端口')
  return {plugins:[uni()],server:{host:'127.0.0.1',port:frontendPort,strictPort:true,proxy:{'/api':{target:`http://127.0.0.1:${apiPort}`,changeOrigin:true}}}}
})
