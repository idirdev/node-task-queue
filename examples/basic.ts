import {
  TaskQueue,
  Worker,
  Scheduler,
  TaskStore,
  MetricsCollector,
  createLoggingMiddleware,
} from '../src';

async function main() {
  // Create the queue with custom config
  const queue = new TaskQueue({
    name: 'email-queue',
    maxSize: 5000,
    defaultTimeout: 15000,
  });

  // Attach middleware
  queue.use(createLoggingMiddleware({ logData: true }));
  const metrics = new MetricsCollector(queue);
  queue.use(metrics);

  // Create a persistent store
  const store = new TaskStore(queue);
  store.startAutoCleanup(60000, 3600000); // cleanup every minute, remove tasks older than 1 hour

  // Create a worker with concurrency of 3
  const worker = new Worker(queue, { concurrency: 3, pollInterval: 500 });

  // Register task handlers
  worker.register('send-email', async (task, helpers) => {
    const { to, subject, body } = task.data;
    helpers.log(`Sending email to ${to}: "${subject}"`);
    helpers.reportProgress(10);

    // Simulate SMTP connection
    await sleep(200);
    helpers.reportProgress(50);

    // Simulate sending
    await sleep(300);
    helpers.reportProgress(100);

    console.log(`  -> Email sent to ${to}`);
    return { messageId: `msg_${Date.now()}`, delivered: true };
  });

  worker.register('generate-report', async (task, helpers) => {
    const { reportType, userId } = task.data;
    helpers.log(`Generating ${reportType} report for user ${userId}`);

    for (let i = 0; i <= 100; i += 20) {
      helpers.reportProgress(i);
      await sleep(100);
    }

    return { url: `/reports/${reportType}_${userId}.pdf` };
  });

  // Listen to events
  worker.on('taskComplete', (result) => {
    console.log(`Task ${result.taskId} completed in ${result.duration}ms`);
  });
  worker.on('taskFailed', (result) => {
    console.error(`Task ${result.taskId} failed: ${result.error}`);
  });

  // Start the worker
  worker.start();

  // Enqueue some email tasks
  const emails = [
    { to: 'alice@example.com', subject: 'Welcome!', body: 'Hello Alice.' },
    { to: 'bob@example.com', subject: 'Invoice #42', body: 'Please pay.' },
    { to: 'carol@example.com', subject: 'Newsletter', body: 'Monthly update.' },
  ];

  for (const email of emails) {
    queue.enqueue('send-email', email, {
      priority: email.subject.includes('Invoice') ? 'high' : 'normal',
      group: 'emails',
    });
  }

  // Enqueue a report task with lower priority
  queue.enqueue('generate-report', { reportType: 'monthly', userId: 'u_123' }, {
    priority: 'low',
    group: 'reports',
  });

  // Schedule a recurring task
  const scheduler = new Scheduler(queue);
  scheduler.schedule('send-email', {
    to: 'team@example.com',
    subject: 'Daily Digest',
    body: 'Here is your daily digest.',
  }, {
    interval: 86400000, // every 24 hours
    priority: 'normal',
  });

  // Wait for all tasks to process
  await sleep(3000);

  // Print metrics
  const snapshot = metrics.getSnapshot();
  console.log('\n--- Metrics ---');
  console.log(`Processed: ${snapshot.tasksProcessed}`);
  console.log(`Failed: ${snapshot.tasksFailed}`);
  console.log(`Avg latency: ${snapshot.avgLatency}ms`);
  console.log(`Throughput: ${snapshot.throughputPerMinute}/min`);
  console.log(`Error rate: ${snapshot.errorRate}%`);

  // Print queue stats
  const stats = queue.getStats();
  console.log('\n--- Queue Stats ---');
  console.log(`Pending: ${stats.pending}, Running: ${stats.running}`);
  console.log(`Completed: ${stats.completed}, Failed: ${stats.failed}`);

  // Export store snapshot
  const storeExport = store.export();
  console.log(`\nStore contains ${storeExport.tasks.length} tasks`);

  // Shutdown
  scheduler.stop();
  store.stopAutoCleanup();
  await worker.stop();
  console.log('\nDone.');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(console.error);
