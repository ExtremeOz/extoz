module.exports = async function (context, req) {
  context.log("JavaScript HTTP trigger function processed a request. TEST LOG " + req.method);

  context.res = {
    status: 200,
    body: process.cwd()
  };
};
