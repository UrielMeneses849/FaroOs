/* An installed FARO PWA receives Android shares as a POST to this same-origin
   endpoint. Keep the private image only in a short-lived browser cache until
   the finance screen consumes it; no receipt is uploaded by this handler. */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  const scopePath = new URL(self.registration.scope).pathname
  if (event.request.method !== 'POST' || url.pathname !== `${scopePath}share-target`) return

  event.respondWith((async () => {
    const destination = new URL(`${scopePath}finance`, self.location.origin)
    try {
      const form = await event.request.formData()
      const file = form.get('receipt')
      const imageFile = file instanceof File && (file.type.startsWith('image/') || /\.(?:png|jpe?g|webp)$/i.test(file.name))
      if (!imageFile || file.size > 15 * 1024 * 1024) {
        destination.searchParams.set('receiptError', 'unsupported')
        return Response.redirect(destination.href, 303)
      }
      const token = self.crypto.randomUUID()
      const key = new URL(`${scopePath}__receipt/${token}`, self.location.origin)
      const cache = await caches.open('faro-shared-receipts-v1')
      await Promise.all((await cache.keys()).map((request) => cache.delete(request)))
      await cache.put(key.href, new Response(file, {
        headers: { 'Content-Type': file.type || 'image/png', 'X-Faro-File-Name': encodeURIComponent(file.name || 'comprobante.png') },
      }))
      destination.searchParams.set('sharedReceipt', token)
    } catch {
      destination.searchParams.set('receiptError', 'unavailable')
    }
    return Response.redirect(destination.href, 303)
  })())
})
