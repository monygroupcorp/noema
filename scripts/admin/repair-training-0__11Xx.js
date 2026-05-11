/**
 * One-off repair: fix training job for 0__11Xx model
 *
 * This job was falsely marked FAILED due to the partialRecovery bug (now fixed).
 * The model exists on HuggingFace, trigger word is active, 4 sample images uploaded.
 * We need to:
 *   1. Find the training job
 *   2. Create the loraModels document if missing
 *   3. Mark the training COMPLETED with the correct fields
 *   4. Refresh LoRA cache
 *
 * Usage:
 *   node -r dotenv/config scripts/admin/repair-training-0__11Xx.js
 */

const { MongoClient, ObjectId } = require('mongodb');

const HF_MODEL_URL = 'https://huggingface.co/ms2stationthis/0__11Xx';
const MODEL_NAME = '0__11Xx';
const TRIGGER_WORD = '0__11Xx';

async function main() {
  const mongoUri = process.env.MONGO_PASS;
  if (!mongoUri) throw new Error('MONGO_PASS env var required');

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db('noema');

  // ── 1. Find the training job ─────────────────────────────────────────────
  const job = await db.collection('trainingJobs').findOne({
    modelName: MODEL_NAME,
    status: 'FAILED',
  });

  if (!job) {
    // Try any status in case it was already partially fixed
    const anyJob = await db.collection('trainingJobs').findOne({ modelName: MODEL_NAME });
    if (!anyJob) {
      console.error(`No training job found for modelName="${MODEL_NAME}"`);
      process.exit(1);
    }
    console.log(`Found job ${anyJob._id} with status=${anyJob.status} — nothing to fix or already fixed.`);
    console.log(JSON.stringify({ _id: anyJob._id, status: anyJob.status, modelRepoUrl: anyJob.modelRepoUrl }, null, 2));
    await client.close();
    return;
  }

  const jobId = job._id.toString();
  console.log(`Found FAILED job: ${jobId}`);
  console.log(`  modelName:       ${job.modelName}`);
  console.log(`  triggerWord:     ${job.triggerWord}`);
  console.log(`  ownerAccountId:  ${job.ownerAccountId}`);
  console.log(`  walletAddress:   ${job.walletAddress}`);
  console.log(`  failureReason:   ${job.failureReason}`);
  console.log(`  gpuType:         ${job.gpuType}`);
  console.log(`  gpuHourlyRate:   ${job.gpuHourlyRate}`);
  console.log(`  estimatedCostPts:${job.estimatedCostPoints}`);
  console.log('');

  // ── 2. Create loraModels document if missing ─────────────────────────────
  let loraModelId = job.loraModelId;

  const existingLora = await db.collection('loraModels').findOne({
    $or: [
      { trainingId: job._id },
      { trainingId: jobId },
      { name: MODEL_NAME },
      { triggerWord: TRIGGER_WORD },
    ]
  });

  if (existingLora) {
    console.log(`LoRA model already exists: ${existingLora._id}`);
    loraModelId = existingLora._id;
  } else {
    console.log('Creating loraModels document...');
    const now = new Date();
    const loraDoc = {
      name: MODEL_NAME,
      triggerWord: TRIGGER_WORD,
      triggerWords: [TRIGGER_WORD],
      ownerAccountId: job.ownerAccountId,
      masterAccountId: job.ownerAccountId,
      walletAddress: job.walletAddress,
      baseModel: job.baseModel || 'FLUX',
      modelType: job.modelType || 'FLUX',
      modelUrl: HF_MODEL_URL,
      hfRepoUrl: HF_MODEL_URL,
      trainingId: job._id,
      datasetId: job.datasetId || null,
      steps: job.steps || null,
      trainedFrom: {
        trainingId: job._id,
        captionSetId: job.captionSetId || null,
        tool: 'ai-toolkit',
        steps: job.steps || null,
      },
      status: 'ready',
      isPublic: false,
      createdAt: now,
      updatedAt: now,
    };
    const result = await db.collection('loraModels').insertOne(loraDoc);
    loraModelId = result.insertedId;
    console.log(`Created loraModels document: ${loraModelId}`);
  }

  // ── 3. Mark training COMPLETED ───────────────────────────────────────────
  console.log('Marking training COMPLETED...');
  const now = new Date();

  await db.collection('trainingJobs').updateOne(
    { _id: job._id },
    {
      $set: {
        status: 'COMPLETED',
        completedAt: now,
        updatedAt: now,
        loraModelId,
        modelRepoUrl: HF_MODEL_URL,
        triggerWords: [TRIGGER_WORD],
        // Keep existing costReconciled state — don't double-charge
      },
      $unset: { failureReason: '' },
    }
  );

  console.log(`Training ${jobId} marked COMPLETED.`);
  console.log(`  modelRepoUrl: ${HF_MODEL_URL}`);
  console.log(`  loraModelId:  ${loraModelId}`);
  console.log('');
  console.log('Done. Run `refreshPublicLoraCache` or redeploy to pick up the trigger word.');
  console.log('(The LoRA cache will auto-refresh on the next training completion or server restart.)');

  await client.close();
}

main().catch(err => {
  console.error('repair script failed:', err);
  process.exit(1);
});
