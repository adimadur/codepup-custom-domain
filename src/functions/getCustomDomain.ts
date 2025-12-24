import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { sql } from "../db/neon";

export async function getCustomDomain(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    if (request.method !== "GET") {
      return {
        status: 405,
        jsonBody: { error: "Use GET method." }
      };
    }

    const projectId = request.query.get("projectId");

    if (!projectId) {
      return {
        status: 400,
        jsonBody: { error: "Missing projectId query param." }
      };
    }

    // ----------------------------------------
    // Fetch custom domain record
    // ----------------------------------------
    const result = await sql`
      SELECT
        project_id,
        project_name,
        deployment_url,
        custom_domain,
        required_dns,
        fully_verified
      FROM custom_domains
      WHERE project_id = ${projectId}
      LIMIT 1;
    `;

    if (result.length === 0) {
      return {
        status: 200,
        jsonBody: { exists: false }
      };
    }

    const row = result[0];

    return {
      status: 200,
      jsonBody: {
        exists: true,
        projectId: row.project_id,
        projectName: row.project_name,
        deploymentUrl: row.deployment_url,
        customDomain: row.custom_domain,
        fullyVerified: row.fully_verified,
        requiredDns: row.fully_verified ? null : row.required_dns
      }
    };

  } catch (err: any) {
    context.log("getCustomDomain error", err);
    return {
      status: 500,
      jsonBody: {
        error: "Internal server error",
        message: err.message
      }
    };
  }
}

app.http("getCustomDomain", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: getCustomDomain
});
