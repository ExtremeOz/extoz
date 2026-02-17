export default async function (context, req) {
  // use req here
  context.res = {
    status: 200,
    body: process.cwd() 
  };
}
