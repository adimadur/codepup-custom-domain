import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

export async function addCustomDomain(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    try {
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

        // STEP 1 — Add domain
        const addRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/domains`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ name: domain })
        });

        const addData = await addRes.json();

        // Extract TXT Records if needed
        const txtRecords = addData.verification?.map(v => ({
            type: "TXT",
            name: v.domain,
            value: v.value,
        })) ?? [];

        // STEP 2 — Fetch DNS config (A + CNAME)
        const configRes = await fetch(`https://api.vercel.com/v6/domains/${domain}/config`, {
            headers: { "Authorization": `Bearer ${token}` }
        });

        const config = await configRes.json();

        // Build A records
        const aRecords = config.recommendedIPv4?.map(a => ({
            type: "A",
            name: "@",
            value: a.value[0]
        })) ?? [];

        // Build CNAME (for subdomains)
        const cnameRecords = config.recommendedCNAME?.map(c => ({
            type: "CNAME",
            name: domain.split(".")[0], // first segment = subdomain
            value: c.value
        })) ?? [];

        // Final combined DNS instructions
        return {
            status: 200,
            jsonBody: {
                success: true,
                domain,
                projectId,
                requiredDns: {
                    txt: txtRecords,
                    a: aRecords,
                    cname: cnameRecords
                },
                status: {
                    ownershipVerified: addData.verified === true,
                    dnsMisconfigured: config.misconfigured === true,
                    fullyReady: addData.verified === true && config.misconfigured === false
                },
                raw: {
                    addResponse: addData,
                    configResponse: config
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

app.http("addCustomDomain", {
    methods: ["POST"],
    authLevel: "anonymous",
    handler: addCustomDomain
});
