const api = require('../lib/api');
const svc = require('../lib/service');

(async () => {
    await api.init({ processOnly: true });
    const status = api.getStatus();
    console.log('Available ports:', status.endpoints.map(e => `${e.port} (${e.windowTitle})`));

    const list = svc.listConversations();
    const sshConvs = list.conversations.filter(c => c.workspace && c.workspace.includes('SSH'));
    console.log(`\nSSH conversations: ${sshConvs.length}`);

    const testConv = sshConvs[0];
    console.log(`\nTesting SSH: "${testConv.title}" (${testConv.id})`);

    for (const ep of status.endpoints) {
        console.log(`  Port ${ep.port} (${ep.windowTitle}):`);
        try {
            const r = await api.getTrajectory(testConv.id, { port: ep.port });
            console.log(`    ✅ Steps: ${r.trajectory?.steps?.length}`);
        } catch (e) {
            console.log(`    ❌ ${e.message.substring(0, 80)}`);
        }
    }

    const localConv = list.conversations.find(c => c.workspace && !c.workspace.includes('SSH'));
    console.log(`\nTesting Local: "${localConv.title}" (${localConv.id})`);
    for (const ep of status.endpoints) {
        console.log(`  Port ${ep.port} (${ep.windowTitle}):`);
        try {
            const r = await api.getTrajectory(localConv.id, { port: ep.port });
            console.log(`    ✅ Steps: ${r.trajectory?.steps?.length}`);
        } catch (e) {
            console.log(`    ❌ ${e.message.substring(0, 80)}`);
        }
    }
})();
