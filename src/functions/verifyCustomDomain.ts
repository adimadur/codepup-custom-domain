import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

export async function verifyCustomDomain(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    try {
        if (request.method !== "POST") {
            return { status: 405, jsonBody: { error: "Method not allowed. Use POST." } };
        }

        const body = await request.json().catch(() => null);
        // @ts-ignore
        if (!body || !body.domain || !body.projectId) {
            return { status: 400, jsonBody: { error: "Missing required fields: domain, projectId" } };
        }
        // @ts-ignore
        const { domain, projectId } = body;
        const token = process.env.VERCEL_TOKEN;

        if (!token) {
            return { status: 500, jsonBody: { error: "VERCEL_TOKEN not found." } };
        }

        // STEP 1 — TXT Verification
        const verifyUrl = `https://api.vercel.com/v9/projects/${projectId}/domains/${domain}/verify`;

        const txtRes = await fetch(verifyUrl, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        });

        const txtData = await txtRes.json();

        if (!txtRes.ok && txtData?.error?.code === "missing_txt_record") {
            return {
                status: 400,
                jsonBody: {
                    success: false,
                    type: "missing-txt-record",
                    message: "Domain ownership cannot be verified yet.",
                    requiredRecords: [
                        {
                            type: "TXT",
                            host: txtData.error.record.name,
                            value: txtData.error.record.value,
                            ttl: 60
                        }
                    ],
                    raw: txtData
                }
            };
        }

        // STEP 2 — FULL DNS CONFIG (A, CNAME, TXT)
        const configUrl = `https://api.vercel.com/v6/domains/${domain}/config`;

        const configRes = await fetch(configUrl, {
            headers: { "Authorization": `Bearer ${token}` }
        });

        const configData = await configRes.json();

        const requiredRecords: any[] = [];
        const currentRecords: any[] = [];

        // CURRENT A VALUES
        if (Array.isArray(configData.aValues)) {
            configData.aValues.forEach((ip: string) => {
                currentRecords.push({
                    type: "A",
                    host: "@",
                    value: ip
                });
            });
        }

        // CURRENT CNAME values
        if (Array.isArray(configData.cnames)) {
            configData.cnames.forEach((c: string) => {
                currentRecords.push({
                    type: "CNAME",
                    host: "@",
                    value: c
                });
            });
        }

        // EXPECTED / REQUIRED RECORDS → Recommended A
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

        // EXPECTED CNAME RECORD
        if (Array.isArray(configData.recommendedCNAME)) {
            configData.recommendedCNAME.forEach((r: any) => {
                requiredRecords.push({
                    type: "CNAME",
                    host: "@",
                    value: r.value,
                    ttl: 60
                });
            });
        }

        // EXPECTED TXT CHALLENGES
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

        return {
            status: 200,
            jsonBody: {
                success: true,
                domain,
                projectId,

                txtVerified: txtRes.ok,
                dnsMisconfigured: configData.misconfigured === true,
                fullyVerified: txtRes.ok && configData.misconfigured === false,

                currentRecords,
                requiredRecords,

                raw: {
                    txt: txtData,
                    config: configData
                }
            }
        };

    } catch (err: any) {
        return { status: 500, jsonBody: { error: "Internal error", message: err.message } };
    }
}

app.http("verifyCustomDomain", {
    methods: ["POST"],
    authLevel: "anonymous",
    handler: verifyCustomDomain
});
