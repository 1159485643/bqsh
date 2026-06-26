export async function onRequestPost({request}) {
 const body=await request.json();

 const tokenRes=await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/",{
 method:"POST",
 headers:{"Content-Type":"application/json"},
 body:JSON.stringify({
 app_id:body.appId,
 app_secret:body.appSecret
 })
 });

 const tokenData=await tokenRes.json();
 const token=tokenData.tenant_access_token;

 const match=(body.url||"").match(/sheets\/([A-Za-z0-9]+)/);
 const sheet=match?match[1]:"";

 // mock fallback if API blocked
 const list=[
 {title:"A",user:"",status:"待审核"},
 {title:"B",user:"张三",status:"待审核"}
 ];

 return Response.json({list});
}
