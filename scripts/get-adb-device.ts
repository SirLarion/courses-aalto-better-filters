const proc = Bun.spawn(['adb', 'devices']);

const text = await new Response(proc.stdout).text();
console.log(text.split('\n')[1].split('\t')[0]);
