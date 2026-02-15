import fs from "fs/promises";
import path from "path";

async function loadTenantConfig(tenantId) {
  const filePath = path.join(
    process.cwd(),
    "..",                // go up from /api
    "tenants",
    `${tenantId}.json`
  );

  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Tenant load error:", err.message);
    return null;
  }
}


function buildResponse(status, body, origin) {
  return {
    status,
    body,
    headers: {
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    }
  };
}

export default async function (context, req) {

  const origin = req.headers.origin;

  // Handle CORS preflight
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

  const tenant = await loadTenantConfig(tenantId);

  if (!tenant) {
    context.res = buildResponse(404, "Invalid tenant", origin);
    return;
  }

/*   if (
    tenant.policy?.allowedOrigins &&
    !tenant.policy.allowedOrigins.includes(origin)
  ) {
    context.res = buildResponse(403, "Origin not allowed", origin);
    return;
  } */
  if (tenant.policy?.allowedOrigins?.length) {
    const allowed = tenant.policy.allowedOrigins.map(o => o.toLowerCase());
    const reqOrigin = (origin || "").toLowerCase();

    if (!allowed.includes(reqOrigin)) {
      context.res = buildResponse(403, "Origin not allowed", origin);
      return;
    }
  }

  if (!body.idempotencyKey) {
    context.res = buildResponse(400, "Missing idempotencyKey", origin);
    return;
  }

  if (!tenant.endpoints?.verifyHttpFlow) {
    context.res = buildResponse(500, "Tenant misconfigured", origin);
    return;
  }

  let response;

  try {
    response = await fetch(
      tenant.endpoints.verifyHttpFlow,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }
    );
  } catch {
    context.res = buildResponse(502, "Upstream service failed", origin);
    return;
  }

  context.res = buildResponse(
    response.status,
    await response.text(),
    origin
  );
}
