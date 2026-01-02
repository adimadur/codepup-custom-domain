import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { sql } from "../db/neon";

/**
 * Retrieves custom domain configuration for a project.
 * Returns DNS requirements only if domain is not yet verified.
 * Used by frontend to show domain status and DNS instructions.
 */
export async function getCustomDomain(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    // Enforce GET method
    if (request.method !== "GET") {
      return {
        status: 405,
        jsonBody: { error: "Use GET method." }
      };
    }

    // Extract and validate projectId from query params
    const projectId = request.query.get("projectId");

    if (!projectId) {
      return {
        status: 400,
        jsonBody: { error: "Missing projectId query param." }
      };
    }

    // ----------------------------------------
    // Query database for custom domain configuration
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

    // Return early if no custom domain configured for this project
    if (result.length === 0) {
      return {
        status: 200,
        jsonBody: { exists: false }
      };
    }

    const row = result[0];

    // Return DNS requirements only if domain not yet verified
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
