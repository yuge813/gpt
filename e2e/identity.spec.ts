import { test, expect, type Page } from '@playwright/test'

async function mine(page:Page){
 await page.locator('.m-desktop-nav:visible,.m-mobile-nav:visible').getByTestId('customer-nav-mine').click()
}
async function openLogin(page:Page){
 await mine(page)
 await page.getByRole('button',{name:'登录 / 注册',exact:true}).click()
}
async function credentials(page:Page,username:string,password:string){
 await page.getByTestId('account-username').locator('input').fill(username)
 await page.getByTestId('account-password').locator('input').fill(password)
}

test('registered account restores its cart and password change revokes previous sessions',async({page},info)=>{
 const username=`member_${info.project.name}_${Date.now()}`
 const oldPassword='browser-only-old-password-47',newPassword='browser-only-new-password-83'
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto('/');await openLogin(page)
 await page.getByTestId('account-tab-register').click()
 await credentials(page,username,oldPassword)
 await page.getByTestId('account-password-confirm').locator('input').fill(oldPassword)
 await page.locator('.m-consent').click()
 await page.getByTestId('account-submit').click()
 await expect(page.locator('.m-modal-mask')).toHaveCount(0)
 await expect(page.locator('.m-profile')).toContainText(username)
 await page.locator('.m-brand').click()
 await page.getByRole('button',{name:/加入购物车 声屿/}).click()
 await expect(page.locator('.m-header-cart')).toContainText('1')
 await mine(page);await page.getByRole('button',{name:'退出登录',exact:true}).click()
 await openLogin(page);await page.getByTestId('account-tab-login').click()
 await credentials(page,username.toUpperCase(),oldPassword)
 await page.getByTestId('account-submit').click()
 await expect(page.locator('.m-modal-mask')).toHaveCount(0)
 await expect(page.locator('.m-header-cart')).toContainText('1')
 const other=await page.request.post('/api/auth/login',{data:{username,password:oldPassword}})
 expect(other.status()).toBe(200)
 const otherToken=(await other.json()).token
 await mine(page);await page.getByTestId('account-password-entry').click()
 await page.getByTestId('account-current-password').locator('input').fill(oldPassword)
 await page.getByTestId('account-new-password').locator('input').fill(newPassword)
 await page.getByTestId('account-new-password-confirm').locator('input').fill(newPassword)
 await page.getByTestId('account-password-save').click()
 await expect(page.locator('.m-modal-mask')).toHaveCount(0)
 expect((await page.request.get('/api/me',{headers:{Authorization:`Bearer ${otherToken}`}})).status()).toBe(401)
 expect((await page.request.post('/api/auth/login',{data:{username,password:oldPassword}})).status()).toBe(401)
 await page.getByRole('button',{name:'退出登录',exact:true}).click()
 await openLogin(page);await page.getByTestId('account-tab-login').click()
 await credentials(page,username,newPassword);await page.getByTestId('account-submit').click()
 await expect(page.locator('.m-modal-mask')).toHaveCount(0)
 await expect(page.locator('.m-profile')).toContainText(username)
 expect(await page.evaluate(()=>Object.entries(localStorage).some(([key,value])=>/password/i.test(key)||value.includes('browser-only-')))).toBeFalsy()
 expect(errors).toEqual([])
 await page.screenshot({path:`docs/screenshots/${info.project.name}-account.png`,fullPage:true})
})
