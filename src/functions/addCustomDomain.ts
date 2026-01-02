import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { sql } from "../db/neon";

/**
 * Adds a custom domain to an already deployed project.
 * Flow: Add domain to Vercel → Fetch DNS requirements → Store in DB
 * Returns DNS records that user needs to configure in their domain provider.
 */

/**
 * Extracts project name from deployment URL
 * Example: aditya-portfolio-e7hah9.codepup.app → aditya-portfolio-e7hah9
 */
function extractProjectNameFromUrl(url: string): string | null {
  try {
    // Remove the protocol (http:// or https://)
    const hostname = url.replace(/^https?:\/\//, "").split("/")[0];
    
    // Remove "www." if present
    const cleanHostname = hostname.replace(/^www\./, "");
    
    // Extract the first part of the hostname
    return cleanHostname.split(".")[0] ?? null;
  } catch {
    return null;
  }
}

export async function addCustomDomain(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    // Parse and validate request body
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

    // Verify Vercel API credentials are available
    const token = process.env.VERCEL_TOKEN;
    const teamId = process.env.VERCEL_TEAM_ID;

    if (!token) {
      return {
        status: 500,
        jsonBody: { error: "Missing VERCEL_TOKEN" },
      };
    }

    if (!teamId) {
      return {
        status: 500,
        jsonBody: { error: "Missing VERCEL_TEAM_ID" },
      };
    }

    // Extract project name for Vercel API calls
    const projectName = extractProjectNameFromUrl(deploymentUrl);
    if (!projectName) {
      return {
        status: 400,
        jsonBody: { error: "Invalid deploymentUrl" },
      };
    }

    // Determine domain type: apex (example.com) vs subdomain (www.example.com)
    const isApex = domain.split(".").length === 2;
    const subdomain = isApex ? null : domain.split(".")[0];

    // --------------------------------------------------
    // STEP 1 — Add domain to Vercel project (with team ID)
    // --------------------------------------------------
    const addRes = await fetch(
      `https://api.vercel.com/v9/projects/${projectName}/domains?teamId=${teamId}`,
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

    // --------------------------------------------------
    // STEP 2 — Fetch DNS config ONCE (with team ID)
    // --------------------------------------------------
    const configRes = await fetch(
      `https://api.vercel.com/v6/domains/${domain}/config?teamId=${teamId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const configData = await configRes.json();

    // --------------------------------------------------
    // STEP 3 — Build required DNS records (stored as single source of truth)
    // --------------------------------------------------
    const requiredDns = {
      txt: [] as any[],
      a: [] as any[],
      cname: [] as any[],
    };

    // TXT record: Proves domain ownership to Vercel
    if (Array.isArray(addData?.verification)) {
      addData.verification.forEach((v: any) => {
        if (v.type === "TXT") {
          requiredDns.txt.push({
            type: "TXT",
            host: v.domain,
            value: v.value,
            ttl: 60,
          });
        }
      });
    }

    // A record: Routes apex domain traffic to Vercel's servers
    if (isApex && Array.isArray(configData.recommendedIPv4)) {
      configData.recommendedIPv4.forEach((r: any) => {
        r.value.forEach((ip: string) => {
          requiredDns.a.push({
            type: "A",
            host: "@",
            value: ip,
            ttl: 60,
          });
        });
      });
    }

    // CNAME record: Routes subdomain traffic to Vercel
    if (!isApex && Array.isArray(configData.recommendedCNAME)) {
      configData.recommendedCNAME.forEach((r: any) => {
        requiredDns.cname.push({
          type: "CNAME",
          host: subdomain,
          value: r.value,
          ttl: 60,
        });
      });
    }

    // Domain is fully verified when both ownership and routing are confirmed
    const fullyVerified =
      addData?.verified === true && configData?.misconfigured === false;

    // --------------------------------------------------
    // STEP 4 — Save to database (upsert by project_id)
    // --------------------------------------------------
    await sql`
      INSERT INTO custom_domains (
        project_id,
        project_name,
        deployment_url,
        custom_domain,
        required_dns,
        fully_verified,
        created_at,
        updated_at
      )
      VALUES (
        ${projectId},
        ${projectName},
        ${deploymentUrl},
        ${domain},
        ${JSON.stringify(requiredDns)},
        ${fullyVerified},
        now(),
        now()
      )
      ON CONFLICT (project_id)
      DO UPDATE SET
        custom_domain = EXCLUDED.custom_domain,
        required_dns = EXCLUDED.required_dns,
        fully_verified = EXCLUDED.fully_verified,
        updated_at = now();
    `;

    // --------------------------------------------------
    // RESPONSE
    // --------------------------------------------------
    return {
      status: 200,
      jsonBody: {
        success: true,
        domain,
        projectId,
        requiredDns,
        status: {
          ownershipVerified: addData?.verified === true,
          routingVerified: configData?.misconfigured === false,
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
