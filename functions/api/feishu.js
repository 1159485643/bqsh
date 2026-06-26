export async function onRequestPost({request}) {
 const body=await request.json();

 let mock=[
 {id:1,title:"商品A",user:"",status:"待审核"},
 {id:2,title:"商品B",user:"张三",status:"待审核"}
 ];

 if(body.action==="get"){
 return Response.json({data:mock});
 }

 if(body.action==="update"){
 return Response.json({ok:true});
 }

 return Response.json({data:mock});
}
