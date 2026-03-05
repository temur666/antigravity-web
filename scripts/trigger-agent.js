const { grpcCall } = require('../lib/core/ls-discovery');
const { buildSendBody, DEFAULT_CONFIG } = require('../lib/core/ws-protocol');

const port = 42100;
const csrf = 'daemon-with-ext-server';

(async () => {
    console.log('--- Starting Agent Test ---');
    const r1 = await grpcCall(port, csrf, 'StartCascade', {}, 10000);
    const cid = r1.data.cascadeId;
    console.log('=> Session created:', cid);

    const config = { ...DEFAULT_CONFIG, model: 'MODEL_PLACEHOLDER_M18', agenticMode: true };
    const body = buildSendBody(cid, 'I need you to read the file package.json', config);

    console.log('=> Asking agent to read file (streaming)...');
    grpcCall(port, csrf, 'SendUserCascadeMessage', body, 30000).catch(e => console.log('=> Send stream finished/closed'));

    for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const r3 = await grpcCall(port, csrf, 'GetCascadeTrajectory', { cascadeId: cid }, 10000);
        const trajectory = r3.data?.trajectory;
        if (!trajectory) continue;

        const steps = trajectory.steps || [];
        const waitingStep = steps.findIndex(s => s.status === 'CORTEX_STEP_STATUS_WAITING');

        if (waitingStep >= 0) {
            console.log(`\n>>> Detected tool call waiting for approval [Step ${waitingStep}]: ${steps[waitingStep].type}`);
            await grpcCall(port, csrf, 'HandleCascadeUserInteraction', { cascadeId: cid, stepIndex: waitingStep, accepted: true });
            console.log('>>> Automatically Approved !!!\n');
        } else {
            const active = steps[steps.length - 1];
            if (active && active.status !== 'CORTEX_STEP_STATUS_COMPLETED') {
                console.log(`... Processing step [${active.type}]: ${active.status}`);
            }
        }
    }
    console.log('--- Agent Test Completed ---');
})().catch(e => {
    console.error('FATAL ERROR:', e.message);
    process.exit(1);
});
