import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { sql } from "../db/neon";

export async function verifyCustomDomain(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    if (request.method !== "POST") {
      return {
        status: 405,
        jsonBody: { error: "Use POST method." }
      };
    }

    const body = await request.json().catch(() => null);
    // @ts-ignore
    if (!body?.domain || !body?.projectId || !body?.projectName) {
      return {
        status: 400,
        jsonBody: {
          error: "Missing required fields: domain, projectId, projectName"
        }
      };
    }
    // @ts-ignore
    const { domain, projectId, projectName } = body;
    const token = process.env.VERCEL_TOKEN;

    if (!token) {
      return {
        status: 500,
        jsonBody: { error: "Missing VERCEL_TOKEN." }
      };
    }

    // ----------------------------------------
    // STEP 1 — Ask Vercel: is domain verified?
    // ----------------------------------------
    const verifyRes = await fetch(
      `https://api.vercel.com/v9/projects/${projectName}/domains/${domain}/verify`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    const verifyData = await verifyRes.json();

    // ----------------------------------------
    // STEP 2 — If verified → update DB
    // ----------------------------------------
    if (verifyRes.ok && verifyData?.verified === true) {
      await sql`
        UPDATE custom_domains
        SET
          fully_verified = TRUE,
          updated_at = now()
        WHERE project_id = ${projectId};
      `;

      return {
        status: 200,
        jsonBody: {
          success: true,
          domain,
          projectId,
          fullyVerified: true
        }
      };
    }

    // ----------------------------------------
    // STEP 3 — Not verified → return error
    // ----------------------------------------
    return {
      status: verifyRes.status,
      jsonBody: {
        success: false,
        error: verifyData?.error?.code ?? "verification_failed",
        message: verifyData?.error?.message ?? "Domain verification failed",
        fullyVerified: false
      }
    };

  } catch (err: any) {
    context.log("verifyCustomDomain error", err);
    return {
      status: 500,
      jsonBody: {
        error: "Internal server error",
        message: err.message
      }
    };
  }
}

app.http("verifyCustomDomain", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: verifyCustomDomain
});
