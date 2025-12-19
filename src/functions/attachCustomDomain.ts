import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

// Helper function to sanitize and validate deploymentUrl
function sanitizeAndValidateDeploymentUrl(raw: string): string {
    if (!raw || typeof raw !== "string") {
        throw new Error("deploymentUrl must be a string.");
    }

    let url = raw.trim().toLowerCase();

    // Remove protocol
    url = url.replace(/^https?:\/\//, "");

    // Remove leading "www."
    url = url.replace(/^www\./, "");

    // Remove trailing slash
    url = url.replace(/\/$/, "");

    // Reject if any slash exists (hostname must not contain /)
    if (url.includes("/")) {
        throw new Error("deploymentUrl must not contain any path segments.");
    }

    // Allowed: letters, numbers, hyphens, dots
    if (!/^[a-z0-9.-]+$/.test(url)) {
        throw new Error("deploymentUrl contains invalid characters.");
    }

    // Must end with .vercel.app
    if (!url.endsWith(".vercel.app")) {
        throw new Error("deploymentUrl must end with '.vercel.app'.");
    }

    // Deployment slug must match:
    // something-like-this-123abc.vercel.app
    const deploymentPattern = /^[a-z0-9-]+\.[a-z0-9-]+\.vercel\.app$/;
    if (!deploymentPattern.test(url)) {
        throw new Error("deploymentUrl does not match a valid Vercel deployment hostname.");
    }

    return url;
}

// Helper function to validate domain format (basic check)
function isValidHostname(domain: string): boolean {
    return /^[a-z0-9.-]+$/i.test(domain) && !domain.includes("..") && !domain.startsWith(".");
}

export async function attachCustomDomain(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    try {
        context.log(`Incoming request: ${request.method} ${request.url}`);

        if (request.method !== "POST") {
            // Reject non-POST methods
            return {
                status: 405,
                jsonBody: { error: "Method not allowed. Use POST." }
            };
        }

        // Parse and validate the request body
        const body = await request.json().catch(() => null);
        // @ts-ignore
        if (!body || !body.domain || !body.projectId || !body.deploymentUrl) {
            return {
                status: 400,
                jsonBody: {
                    error: "Missing required fields: domain, projectId, deploymentUrl"
                }
            };
        }

        // Destructure the values from the body
        // @ts-ignore
        const { domain, projectId, deploymentUrl } = body;
        const token = process.env.VERCEL_TOKEN;

        // Check if VERCEL_TOKEN is available in environment variables
        if (!token) {
            return {
                status: 500,
                jsonBody: { error: "VERCEL_TOKEN not found in environment." }
            };
        }

        // Sanitize and validate deploymentUrl
        let sanitizedDeploymentUrl: string;
        try {
            sanitizedDeploymentUrl = sanitizeAndValidateDeploymentUrl(deploymentUrl);
        } catch (err: any) {
            return {
                status: 400,
                jsonBody: { 
                    error: "Invalid deploymentUrl",
                    message: err.message 
                }
            };
        }
        // Validate domain format
        if (!isValidHostname(domain)) {
            return {
                status: 400,
                jsonBody: { error: "Invalid domain format.",
                    message: "Domain must be a valid hostname."
                }
            };
        }

        // Step 1: Get the deployment ID from the deployment URL
        const deploymentRes = await fetch(`https://api.vercel.com/v13/deployments/${sanitizedDeploymentUrl}`, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`,
            }
        });

        const deploymentData = await deploymentRes.json();

        // Handle deployment fetch errors
        if (!deploymentRes.ok) {
            if (deploymentRes.status === 404) {
                return {
                    status: 404,
                    jsonBody: { error: "Deployment not found", details: deploymentData }
                };
            }

            return {
                status: deploymentRes.status,
                jsonBody: {
                    error: "Failed to fetch deployment data",
                    details: deploymentData
                }
            };
        }

        // Extract the deployment ID
        const deploymentId = deploymentData.id;

        // Step 2: Attach the domain to the specific deployment (via alias API)
        const aliasRes = await fetch(`https://api.vercel.com/v2/deployments/${deploymentId}/aliases`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ alias: domain })
        });

        const aliasData = await aliasRes.json();

        // Handle alias creation errors
        if (!aliasRes.ok) {
            if (aliasRes.status === 400) {
                return {
                    status: 400,
                    jsonBody: {
                        error: "Bad request to attach alias",
                        details: aliasData
                    }
                };
            }

            return {
                status: aliasRes.status,
                jsonBody: {
                    error: "Vercel API error while attaching alias",
                    details: aliasData
                }
            };
        }

        // Step 3: Return the success response with alias details
        return {
            status: 200,
            jsonBody: {
                success: true,
                domain,
                projectId,
                deploymentUrl,
                message: `Domain ${domain} successfully attached to deployment.`,
                alias: aliasData.alias
            }
        };

    } catch (err: any) {
        // Catch unexpected errors and return a generic server error
        context.log("Error:", err);
        return {
            status: 500,
            jsonBody: { error: "Internal server error", message: err.message }
        };
    }
}

// Register the function in Azure Functions (HTTP trigger)
app.http("attachCustomDomain", {
    methods: ["POST"],
    authLevel: "anonymous",  // Allow anonymous access
    handler: attachCustomDomain
});
