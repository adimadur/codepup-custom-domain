import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

export async function verifyCustomDomain(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    try {
        if (request.method !== "POST") {
            return {
                status: 405,
                jsonBody: { error: "Method not allowed. Use POST." }
            };
        }

        // Parse request body
        const body = await request.json().catch(() => null);

        // @ts-ignore
        if (!body || !body.domain || !body.projectId) {
            return {
                status: 400,
                jsonBody: { error: "Missing required fields: domain, projectId" }
            };
        }

        // @ts-ignore
        const { domain, projectId } = body;
        const token = process.env.VERCEL_TOKEN;

        if (!token) {
            return {
                status: 500,
                jsonBody: { error: "VERCEL_TOKEN not found." }
            };
        }

        // ---------------------------------------------------------
        // STEP 1 — TXT Verification (ownership)
        // ---------------------------------------------------------
        const verifyUrl = `https://api.vercel.com/v9/projects/${projectId}/domains/${domain}/verify`;

        const txtRes = await fetch(verifyUrl, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        });

        const txtData = await txtRes.json();

        // If missing TXT record → return required TXT
        if (!txtRes.ok && txtData?.error?.code === "missing_txt_record") {
            return {
                status: 400,
                jsonBody: {
                    success: false,
                    type: "missing-txt-record",
                    message: "Domain ownership not verified. Add the required TXT record.",
                    requiredRecords: [
                        {
                            type: "TXT",
                            host: txtData.error.record.name,
                            value: txtData.error.record.value,
                            ttl: 60
                        }
                    ],
                    raw: {
                        txtVerification: txtData
                    }
                }
            };
        }

        // ---------------------------------------------------------
        // STEP 2 — Full DNS config (A, CNAME, TXT)
        // ---------------------------------------------------------
        const configUrl = `https://api.vercel.com/v6/domains/${domain}/config`;

        const configRes = await fetch(configUrl, {
            headers: { "Authorization": `Bearer ${token}` }
        });

        const configData = await configRes.json();

        // BUILD FINAL DNS OBJECTS
        const currentRecords: any[] = [];
        const requiredRecords: any[] = [];

        // CURRENT A records (if any)
        if (Array.isArray(configData.aValues)) {
            configData.aValues.forEach((ip: string) => {
                currentRecords.push({
                    type: "A",
                    host: "@",
                    value: ip
                });
            });
        }

        // CURRENT CNAMEs
        if (Array.isArray(configData.cnames)) {
            configData.cnames.forEach((cname: string) => {
                currentRecords.push({
                    type: "CNAME",
                    host: "@",
                    value: cname
                });
            });
        }

        // EXPECTED A records
        if (Array.isArray(configData.recommendedIPv4)) {
            configData.recommendedIPv4.forEach((r: any) => {
                r.value.forEach((ip: string) => {
                    requiredRecords.push({
                        type: "A",
                        host: "@",
                        value: ip,
                        ttl: 60
                    });
                });
            });
        }

        // EXPECTED CNAME (ONLY for subdomains)
        if (Array.isArray(configData.recommendedCNAME)) {
            configData.recommendedCNAME.forEach((r: any) => {
                const label = domain.split(".")[0]; // e.g. app.myapp.com → "app"

                // Skip CNAME for root apex domain
                if (label === "www" || domain.split(".").length > 2) {
                    requiredRecords.push({
                        type: "CNAME",
                        host: label,
                        value: r.value,
                        ttl: 60
                    });
                }
            });
        }

        // EXPECTED TXT verification records (if any still required)
        if (Array.isArray(configData.acceptedChallenges)) {
            configData.acceptedChallenges.forEach((c: any) => {
                requiredRecords.push({
                    type: "TXT",
                    host: c.domain,
                    value: c.value,
                    ttl: 60
                });
            });
        }

        // FINAL RESULT
        return {
            status: 200,
            jsonBody: {
                success: true,
                domain,
                projectId,

                ownershipVerified: txtRes.ok,
                dnsMisconfigured: configData.misconfigured === true,
                fullyVerified: txtRes.ok && configData.misconfigured === false,

                currentRecords,
                requiredRecords,

                raw: {
                    txtVerification: txtData,
                    configResponse: configData
                }
            }
        };

    } catch (err: any) {
        return {
            status: 500,
            jsonBody: { error: "Internal server error", message: err.message }
        };
    }
}

app.http("verifyCustomDomain", {
    methods: ["POST"],
    authLevel: "anonymous",
    handler: verifyCustomDomain
});
