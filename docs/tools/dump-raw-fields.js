const { discoverLSAsync, grpcCall } = require('/home/tiemuer/antigravity-web/lib/core/ls-discovery');

(async () => {
    const ls = await discoverLSAsync();
    if (!ls) { console.log('No LS'); return; }
    const result = await grpcCall(ls.port, ls.csrf, 'GetAllCascadeTrajectories', {});
    const ids = Object.keys(result.data?.trajectorySummaries || {});

    const typeMap = {};

    for (const id of ids) {
        const traj = await grpcCall(ls.port, ls.csrf, 'GetCascadeTrajectory', { cascadeId: id });
        const steps = traj.data?.trajectory?.steps || [];
        const meta = traj.data?.trajectory?.generatorMetadata || [];

        if (!typeMap._metadata && meta.length > 0) {
            typeMap._metadata = { sample: meta[0], count: meta.length };
        }

        for (const s of steps) {
            if (typeMap[s.type]) continue;
            const payloadKeys = Object.keys(s).filter(k => !['type', 'status', 'metadata'].includes(k));
            const payloadKey = payloadKeys[0];
            const payload = payloadKey ? s[payloadKey] : null;

            // Deeply collect field structure
            function describeFields(obj, depth = 0) {
                if (!obj || typeof obj !== 'object' || depth > 3) return obj;
                if (Array.isArray(obj)) {
                    if (obj.length === 0) return '[]';
                    return [describeFields(obj[0], depth + 1)];
                }
                const result = {};
                for (const [k, v] of Object.entries(obj)) {
                    if (v === null || v === undefined) {
                        result[k] = null;
                    } else if (typeof v === 'string') {
                        result[k] = v.length > 120 ? v.substring(0, 120) + '...' : v;
                    } else if (typeof v === 'number' || typeof v === 'boolean') {
                        result[k] = v;
                    } else if (Array.isArray(v)) {
                        if (v.length === 0) {
                            result[k] = '[]';
                        } else {
                            result[k] = [describeFields(v[0], depth + 1)];
                            result[k + '_count'] = v.length;
                        }
                    } else if (typeof v === 'object') {
                        result[k] = describeFields(v, depth + 1);
                    }
                }
                return result;
            }

            typeMap[s.type] = {
                payloadKey,
                topLevelKeys: Object.keys(s),
                payloadFields: payload ? describeFields(payload) : null,
            };
        }
    }

    console.log(JSON.stringify(typeMap, null, 2));
})().catch(e => console.error(e.message));
