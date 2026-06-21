self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "Traductor en Vivo";
  const options = {
    body: data.body || "Nuevo mensaje",
    icon: "/icons/icon.svg",
    badge: "/icons/icon.svg",
    data: {
      url: data.url || "/",
      conversation_id: data.conversation_id,
      message_id: data.message_id,
    },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of allClients) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) return client.navigate(targetUrl);
      }
    }
    return clients.openWindow(targetUrl);
  })());
});
