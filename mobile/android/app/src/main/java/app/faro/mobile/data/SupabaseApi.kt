package app.faro.mobile.data

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.builtins.ListSerializer
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.util.UUID

class FaroApiException(message: String) : Exception(message)

/**
 * Thin native client for the already-existing FARO Supabase project. It does
 * not introduce a mobile backend: every REST call is made with the user's JWT,
 * so the existing RLS policies and RPCs remain the authority.
 */
class SupabaseApi(private val sessionStore: SessionStore) {
  private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }
  private val http = HttpClient(OkHttp) {
    install(ContentNegotiation) { json(json) }
    install(HttpTimeout) {
      requestTimeoutMillis = 20_000
      connectTimeoutMillis = 12_000
      socketTimeoutMillis = 20_000
    }
  }

  suspend fun signIn(email: String, password: String): FaroSession {
    AppConfig.requireConfigured()
    val response = http.post("${AppConfig.supabaseUrl}/auth/v1/token?grant_type=password") {
      publicHeaders()
      header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
      setBody(buildJsonObject { put("email", email.trim()); put("password", password) })
    }
    response.requireSuccess()
    val session = response.body<FaroSession>().copy(createdAtMillis = System.currentTimeMillis())
    sessionStore.write(session)
    return session
  }

  suspend fun signOut() {
    val session = sessionStore.read()
    if (session != null && AppConfig.isConfigured) runCatching {
      http.post("${AppConfig.supabaseUrl}/auth/v1/logout") {
        publicHeaders(); bearerAuth(session.accessToken)
      }.requireSuccess()
    }
    sessionStore.clear()
  }

  fun cachedSession(): FaroSession? = sessionStore.read()

  /**
   * PostgREST always returns a JSON array. Receive an explicit serializer so
   * Kotlin keeps the concrete row type at runtime instead of erasing `T`.
   */
  suspend fun <T> list(
    table: String,
    serializer: KSerializer<T>,
    query: Map<String, String> = emptyMap(),
  ): List<T> {
    val session = activeSession()
    val response = http.get("${AppConfig.supabaseUrl}/rest/v1/$table") {
      dataHeaders(session)
      parameter("select", "*")
      query.forEach { (key, value) -> parameter(key, value) }
    }
    response.requireSuccess()
    return json.decodeFromString(ListSerializer(serializer), response.bodyAsText())
  }

  suspend fun <T> insert(table: String, payload: JsonObject): T {
    val session = activeSession()
    val response = http.post("${AppConfig.supabaseUrl}/rest/v1/$table") {
      dataHeaders(session); header("Prefer", "return=representation")
      header(HttpHeaders.ContentType, ContentType.Application.Json.toString()); setBody(payload)
    }
    response.requireSuccess()
    return response.body<List<T>>().first()
  }

  suspend fun <T> update(table: String, id: String, payload: JsonObject): T {
    val session = activeSession()
    val response = http.patch("${AppConfig.supabaseUrl}/rest/v1/$table") {
      dataHeaders(session); header("Prefer", "return=representation")
      parameter("id", "eq.$id")
      header(HttpHeaders.ContentType, ContentType.Application.Json.toString()); setBody(payload)
    }
    response.requireSuccess()
    return response.body<List<T>>().first()
  }

  suspend fun delete(table: String, id: String) {
    val session = activeSession()
    val response = http.delete("${AppConfig.supabaseUrl}/rest/v1/$table") {
      dataHeaders(session); parameter("id", "eq.$id")
    }
    response.requireSuccess()
  }

  suspend fun callRpc(name: String, payload: JsonObject) {
    val session = activeSession()
    val response = http.post("${AppConfig.supabaseUrl}/rest/v1/rpc/$name") {
      dataHeaders(session); header(HttpHeaders.ContentType, ContentType.Application.Json.toString()); setBody(payload)
    }
    response.requireSuccess()
  }

  suspend fun sendVoice(message: String, history: List<VoiceTurn> = emptyList()): VoiceResponse {
    val requestId = UUID.randomUUID().toString()
    return invokeVoice(buildJsonObject {
      put("requestId", requestId)
      put("sessionId", UUID.randomUUID().toString())
      put("source", "voice")
      put("message", message.trim())
      put("surface", "mobile")
      put("pageSurface", "dashboard")
      put("pipeline", "optimized")
      put("history", json.encodeToJsonElement(ListSerializer(VoiceTurn.serializer()), history))
      put("localContext", buildJsonObject {
        put("now", OffsetDateTime.now().toString())
        put("timezone", ZoneId.systemDefault().id)
        put("calendarItems", buildJsonObject { })
      })
    })
  }

  suspend fun confirmVoice(action: PendingVoiceAction): VoiceResponse =
    invokeVoice(buildJsonObject { put("type", "confirm"); put("requestId", action.requestId) })

  suspend fun cancelVoice(action: PendingVoiceAction): VoiceResponse =
    invokeVoice(buildJsonObject { put("type", "cancel"); put("requestId", action.requestId) })

  private suspend fun invokeVoice(body: JsonObject): VoiceResponse {
    var last: Throwable? = null
    repeat(3) { attempt ->
      try {
        val session = activeSession()
        val response = http.post("${AppConfig.supabaseUrl}/functions/v1/faro-voice") {
          dataHeaders(session); header(HttpHeaders.ContentType, ContentType.Application.Json.toString()); setBody(body)
        }
        response.requireSuccess()
        return response.body()
      } catch (error: Throwable) {
        last = error
        if (attempt < 2) kotlinx.coroutines.delay(300L * (attempt + 1))
      }
    }
    throw FaroApiException(last?.message ?: "FARO Voice no está disponible.")
  }

  private suspend fun activeSession(): FaroSession {
    AppConfig.requireConfigured()
    val current = sessionStore.read() ?: throw FaroApiException("Inicia sesión en FARO para continuar.")
    val expiresAt = current.createdAtMillis + (current.expiresIn * 1_000L)
    if (System.currentTimeMillis() < expiresAt - 60_000L) return current
    val response = http.post("${AppConfig.supabaseUrl}/auth/v1/token?grant_type=refresh_token") {
      publicHeaders(); header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
      setBody(buildJsonObject { put("refresh_token", current.refreshToken) })
    }
    if (!response.status.isSuccess()) {
      sessionStore.clear()
      response.requireSuccess()
    }
    val refreshed = response.body<FaroSession>().copy(createdAtMillis = System.currentTimeMillis())
    sessionStore.write(refreshed)
    return refreshed
  }

  private fun io.ktor.client.request.HttpRequestBuilder.publicHeaders() {
    header("apikey", AppConfig.publishableKey)
    header(HttpHeaders.Accept, ContentType.Application.Json.toString())
  }

  private fun io.ktor.client.request.HttpRequestBuilder.dataHeaders(session: FaroSession) {
    publicHeaders(); bearerAuth(session.accessToken)
  }

  private suspend fun HttpResponse.requireSuccess() {
    if (status.isSuccess()) return
    val text = bodyAsText()
    val detail = runCatching {
      json.parseToJsonElement(text).jsonObject["message"]?.toString()?.trim('"')
        ?: json.parseToJsonElement(text).jsonObject["error_description"]?.toString()?.trim('"')
    }.getOrNull()
    throw FaroApiException(detail?.takeIf { it.isNotBlank() } ?: "Error de FARO (${status.value}).")
  }
}

private fun todayIso(): String = LocalDate.now().toString()
