const fs = require("fs/promises");
const path = require("path");

async function loadTenantConfig(tenantId, context, req) {
  const origin = req.headers.origin;
  const url = `${origin}/tenants/${tenantId}.json`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      context.log("Tenant HTTP fetch failed:", response.status);
      return null;
    }

    return await response.json();
  } catch (err) {
    context.log("Tenant fetch error:", err.message);
    return null;
  }
}
function buildResponse(status, body, origin) {
  return {
    status,
    body: typeof body === "string"
      ? JSON.stringify({ message: body })
      : body,
    headers: {
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    }
  };
}

module.exports = async function (context, req) {
  const origin = req.headers.origin;
  if (req.method === "OPTIONS") {
    context.res = buildResponse(200, "", origin);
    return;
  }

  const body = req.body || {};

  const tenantId = String(body.tenant || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");

  if (!tenantId) {
    context.res = buildResponse(400, "Missing tenant", origin);
    return;
  }
  const tenant = await loadTenantConfig(tenantId, context, req);
  if (!tenant) {    
    context.res = buildResponse(404, "Tenant not found", origin);
    return;
  }
  if (tenant.policy?.allowedOrigins?.length) {
    const normalize = (url) => {
      if (!url) return "";
      return url.toLowerCase().replace(/\/$/, "");
    };

    const allowed = tenant.policy.allowedOrigins.map(normalize);
    const reqOrigin = normalize(origin);

    if (!allowed.includes(reqOrigin)) {
      context.res = buildResponse(403, "Origin not allowed", origin);
      return;
    }
  }
  if (!body.idempotencyKey) {
    context.res = buildResponse(400, "Missing idempotencyKey", origin);
    return;
  }

  const flowUrl =
    tenant.endpoints?.verifyHttpFlow;

  if (!flowUrl) {
    context.res = buildResponse(500, "Tenant misconfigured", origin);
    return;
  }

  let response;

  try {
    response = await fetch(flowUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (err) {
    context.log("Fetch error:", err);
    context.res = buildResponse(502, "Upstream service failed", origin);
    return;
  }
  context.res = buildResponse(response.status, await response.text(), origin);
};