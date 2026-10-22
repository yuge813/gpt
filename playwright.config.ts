import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir:'./e2e',fullyParallel:false,workers:1,timeout:45000,
  use:{baseURL:'http://127.0.0.1:5173',launchOptions:{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']},trace:'retain-on-failure'},
  projects:[{name:'desktop',use:{viewport:{width:1440,height:1050}}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}],
  webServer:[
    {command:'node server/index.mjs',url:'http://127.0.0.1:3001/api/health',reuseExistingServer:false,env:{DB_PATH:`.data/e2e-${process.pid}.sqlite`,ADMIN_TOKEN:'e2e-only-admin-credential-not-for-production',APP_MODE:'demo'}},
    {command:'npm run dev',url:'http://127.0.0.1:5173',reuseExistingServer:false,timeout:90000}
  ]
})
