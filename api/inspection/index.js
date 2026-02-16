module.exports = async function (context, req) {
  context.log("Inspection function hit");
  context.res = {
    status: 200,
    body: "OK"
  };
};
