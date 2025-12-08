import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

export async function addCustomDomain(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
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

        if (!token) {
            return {
                status: 500,
                jsonBody: { error: "Missing VERCEL_TOKEN in env" }
            };
        }

        const isApex = domain.split(".").length === 2; // true = root domain like "codepup.dev"
        const subdomainName = !isApex ? domain.split(".")[0] : null;

        // ------------------------------------
        // STEP 1 — Add domain to Vercel project
        // ------------------------------------

        const addRes = await fetch(
            `https://api.vercel.com/v9/projects/${projectId}/domains`,
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ name: domain })
            }
        );

        const addData = await addRes.json();

        // TXT records required for verification (sometimes empty)
        const txtRecords =
            addData.verification?.map((v: any) => ({
                type: "TXT",
                host: v.domain,
                value: v.value,
                ttl: 60
            })) ?? [];

        // ------------------------------------
        // STEP 2 — Fetch recommended DNS config
        // ------------------------------------

        const configRes = await fetch(
            `https://api.vercel.com/v6/domains/${domain}/config`,
            {
                headers: { "Authorization": `Bearer ${token}` }
            }
        );

        const config = await configRes.json();

        // Build final DNS instructions
        const aRecords: any[] = [];
        const cnameRecords: any[] = [];

        if (isApex) {
            // -------------------------
            // ✔ Apex domain → A records only
            // -------------------------
            if (Array.isArray(config.recommendedIPv4)) {
                config.recommendedIPv4.forEach((r: any) =>
                    r.value.forEach((ip: string) =>
                        aRecords.push({
                            type: "A",
                            host: "@",
                            value: ip,
                            ttl: 60
                        })
                    )
                );
            }
        } else {
            // -------------------------
            // ✔ Subdomain → CNAME only
            // -------------------------
            if (Array.isArray(config.recommendedCNAME)) {
                config.recommendedCNAME.forEach((r: any) => {
                    cnameRecords.push({
                        type: "CNAME",
                        host: subdomainName,
                        value: r.value,
                        ttl: 60
                    });
                });
            }
        }

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
                    fullyReady:
                        addData.verified === true && config.misconfigured === false
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
