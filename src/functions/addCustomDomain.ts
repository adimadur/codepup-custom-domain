import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { sql } from "../db/neon";

export async function addCustomDomain(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const body = await request.json().catch(() => null);
    // @ts-ignore
    if (!body?.domain || !body?.projectId || !body?.deploymentUrl) {
      return {
        status: 400,
        jsonBody: {
          error: "Missing required fields: domain, projectId, deploymentUrl",
        },
      };
    }
    // @ts-ignore
    const { domain, projectId, deploymentUrl } = body;
    const token = process.env.VERCEL_TOKEN;

    if (!token) {
      return {
        status: 500,
        jsonBody: { error: "Missing VERCEL_TOKEN" },
      };
    }

    const isApex = domain.split(".").length === 2;
    const subdomain = isApex ? null : domain.split(".")[0];
    const routingType = isApex ? "A" : "CNAME";

    // ---------------------------------------
    // STEP 1 — Add domain to Vercel project
    // ---------------------------------------
    const addRes = await fetch(
      `https://api.vercel.com/v9/projects/${projectId}/domains`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: domain }),
      }
    );

    const addData = await addRes.json();

    // Extract TXT verification (if any)
    const txtRecords =
      addData?.verification?.map((v: any) => ({
        type: "TXT",
        host: v.domain,
        value: v.value,
        ttl: 60,
      })) ?? [];

    const txtVerified = addData?.verified === true;

    // ---------------------------------------
    // STEP 2 — Fetch DNS config (A / CNAME)
    // ---------------------------------------
    const configRes = await fetch(
      `https://api.vercel.com/v6/domains/${domain}/config`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const configData = await configRes.json();
    const routingVerified = configData?.misconfigured === false;

    const requiredDns = {
      txt: txtRecords,
      a: [] as any[],
      cname: [] as any[],
    };

    if (isApex && Array.isArray(configData.recommendedIPv4)) {
      configData.recommendedIPv4.forEach((r: any) =>
        r.value.forEach((ip: string) =>
          requiredDns.a.push({
            type: "A",
            host: "@",
            value: ip,
            ttl: 60,
          })
        )
      );
    }

    if (!isApex && Array.isArray(configData.recommendedCNAME)) {
      configData.recommendedCNAME.forEach((r: any) =>
        requiredDns.cname.push({
          type: "CNAME",
          host: subdomain,
          value: r.value,
          ttl: 60,
        })
      );
    }

    const fullyVerified = txtVerified && routingVerified;

    // ---------------------------------------
    // STEP 3 — UPSERT into Neon
    // ---------------------------------------
    await sql`
      INSERT INTO custom_domains (
        project_id,
        project_name,
        deployment_url,
        custom_domain,

        txt_verified,
        routing_type,
        routing_verified,
        fully_verified,

        last_add_response,
        last_config_response,

        created_at,
        updated_at
      )
      VALUES (
        ${projectId},
        ${projectId},
        ${deploymentUrl},
        ${domain},

        ${txtVerified},
        ${routingType},
        ${routingVerified},
        ${fullyVerified},

        ${JSON.stringify(addData)},
        ${JSON.stringify(configData)},

        now(),
        now()
      )
      ON CONFLICT (project_id)
      DO UPDATE SET
        custom_domain = EXCLUDED.custom_domain,
        txt_verified = EXCLUDED.txt_verified,
        routing_verified = EXCLUDED.routing_verified,
        fully_verified = EXCLUDED.fully_verified,
        last_add_response = EXCLUDED.last_add_response,
        last_config_response = EXCLUDED.last_config_response,
        updated_at = now();
    `;

    // ---------------------------------------
    // RESPONSE
    // ---------------------------------------
    return {
      status: 200,
      jsonBody: {
        success: true,
        domain,
        projectId,
        requiredDns,
        status: {
          ownershipVerified: txtVerified,
          routingVerified,
          fullyVerified,
        },
      },
    };
  } catch (err: any) {
    context.log("addCustomDomain error", err);
    return {
      status: 500,
      jsonBody: {
        error: "Internal server error",
        message: err.message,
      },
    };
  }
}

app.http("addCustomDomain", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: addCustomDomain,
});
