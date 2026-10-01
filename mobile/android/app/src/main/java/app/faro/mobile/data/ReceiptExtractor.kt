package app.faro.mobile.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlinx.coroutines.suspendCancellableCoroutine

/** Reads a shared image/PDF locally. The original file is never uploaded or persisted by this flow. */
object ReceiptExtractor {
  suspend fun analyze(context: Context, receipt: SharedReceipt): ReceiptAnalysis {
    val directText = receipt.sharedText?.trim().orEmpty()
    val uri = receipt.uri?.let(Uri::parse)
    val text = when {
      directText.isNotBlank() -> directText
      uri == null -> ""
      receipt.mimeType == "text/plain" -> readPlainText(context, uri)
      receipt.mimeType == "application/pdf" || receipt.displayName.endsWith(".pdf", ignoreCase = true) -> {
        renderFirstPdfPage(context, uri)?.let { bitmap -> recognize(InputImage.fromBitmap(bitmap, 0)) }.orEmpty()
      }
      receipt.mimeType?.startsWith("image/") == true -> runCatching {
        recognize(InputImage.fromFilePath(context, uri))
      }.getOrDefault("")
      else -> ""
    }
    return ReceiptTextParser.parse(receipt.displayName, text)
  }

  private fun readPlainText(context: Context, uri: Uri): String = runCatching {
    context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }.orEmpty()
  }.getOrDefault("")

  private fun renderFirstPdfPage(context: Context, uri: Uri): Bitmap? = runCatching {
    val descriptor = context.contentResolver.openFileDescriptor(uri, "r") ?: return@runCatching null
    renderFirstPdfPage(descriptor)
  }.getOrNull()

  private fun renderFirstPdfPage(descriptor: ParcelFileDescriptor): Bitmap? {
    val renderer = PdfRenderer(descriptor)
    return try {
      if (renderer.pageCount == 0) return null
      val page = renderer.openPage(0)
      try {
        val largestEdge = max(page.width, page.height).toFloat()
        val scale = min(2f, 1800f / largestEdge)
        val width = max(1, (page.width * scale).roundToInt())
        val height = max(1, (page.height * scale).roundToInt())
        Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { bitmap ->
          page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
        }
      } finally {
        page.close()
      }
    } finally {
      renderer.close()
      descriptor.close()
    }
  }

  private suspend fun recognize(image: InputImage): String = suspendCancellableCoroutine { continuation ->
    val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    recognizer.process(image)
      .addOnSuccessListener { result ->
        recognizer.close()
        if (continuation.isActive) continuation.resume(result.text)
      }
      .addOnFailureListener { error ->
        recognizer.close()
        if (continuation.isActive) continuation.resumeWithException(error)
      }
    continuation.invokeOnCancellation { recognizer.close() }
  }
}
