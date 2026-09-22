// Shared by the page and the generated service worker. Store only the authorization
// metadata from explicit enrollment, never refresh its generation during recovery.
async function pushAuthorization(value) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("k5-push", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("authorization");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("authorization", value ? "readwrite" : "readonly");
      const store = transaction.objectStore("authorization");
      const request = value ? store.put(value, "device") : store.get("device");
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function uploadPushSubscription(subscription, authorization) {
  const response = await fetch("/api/notifications/subscriptions", {
    method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...authorization, endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime, keys: subscription.toJSON().keys,
    }),
  });
  if (!response.ok) {
    const message = await response.json().then((value) => value.error).catch(() => null);
    throw new Error(message || "Falha ao ativar neste dispositivo.");
  }
  await pushAuthorization(authorization);
  return response;
}

export async function recoverPushSubscription(registration) {
  const authorization = await pushAuthorization();
  if (!authorization) return;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const response = await fetch("/api/notifications/subscriptions", { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) return;
  const { subscriptions } = await response.json();
  // A revoked device or a different account must explicitly enroll again.
  if (!subscriptions.some((device) => device.deviceId === authorization.deviceId
    && device.state === "active" && device.vapidKeyId === authorization.vapidKeyId)) return;
  await uploadPushSubscription(subscription, authorization);
}
