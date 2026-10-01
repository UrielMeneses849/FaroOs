#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>
#import <dispatch/dispatch.h>

// FARO Vault keeps its encryption key in a dedicated Keychain item.  The old
// keyring crate entry stays in its original Keychain. Every unlock requires
// Touch ID; macOS may separately request system authorization for an older
// item whose application ACL does not yet trust this signed FARO build.
static NSString *const FaroVaultService = @"com.faroos.desktop.vault";
static NSString *const FaroVaultLegacyAccount = @"xchacha20poly1305-key-v1";
static NSString *const FaroVaultBiometricAccount = @"xchacha20poly1305-biometry-key-v1";

enum {
    FaroVaultKeySuccess = 0,
    FaroVaultKeyMissing = 1,
    FaroVaultKeyFailure = -1,
};

static char *FaroVaultCopyMessage(NSString *message) {
    const char *utf8 = message.UTF8String;
    return utf8 == NULL ? NULL : strdup(utf8);
}

static void FaroVaultSetError(char **outError, NSString *message) {
    if (outError != NULL) {
        *outError = FaroVaultCopyMessage(message);
    }
}

static BOOL FaroVaultAuthenticate(LAContext **outContext, char **outError) {
    LAContext *context = [[LAContext alloc] init];
    // Keep this strictly biometric. FARO must not offer a password fallback in
    // its own authentication path.
    context.localizedFallbackTitle = @"";

    NSError *availabilityError = nil;
    if (![context canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
                              error:&availabilityError]) {
        FaroVaultSetError(outError,
            availabilityError.localizedDescription.length > 0
                ? availabilityError.localizedDescription
                : @"Touch ID no está disponible en este Mac.");
        return NO;
    }

    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    __block BOOL approved = NO;
    __block NSString *message = nil;
    [context evaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
            localizedReason:@"desbloquear FARO Vault"
                      reply:^(BOOL success, NSError * _Nullable error) {
        approved = success;
        if (!success && error.localizedDescription.length > 0) {
            message = error.localizedDescription;
        }
        dispatch_semaphore_signal(semaphore);
    }];

    const long waitResult = dispatch_semaphore_wait(
        semaphore,
        dispatch_time(DISPATCH_TIME_NOW, (int64_t)(65 * NSEC_PER_SEC))
    );
    if (waitResult != 0) {
        [context invalidate];
        FaroVaultSetError(outError, @"Touch ID tardó demasiado. Inténtalo de nuevo.");
        return NO;
    }
    if (!approved) {
        FaroVaultSetError(outError,
            message.length > 0
                ? message
                : @"Touch ID no pudo confirmar tu identidad. Inténtalo de nuevo.");
        return NO;
    }

    *outContext = context;
    return YES;
}

// App-level biometric gate for the user's local-key access mode.
int faro_vault_authenticate_only(char **outError) {
    if (outError != NULL) *outError = NULL;
    @autoreleasepool {
        LAContext *context = nil;
        return FaroVaultAuthenticate(&context, outError) ? FaroVaultKeySuccess : FaroVaultKeyFailure;
    }
}

static OSStatus FaroVaultCopyItem(LAContext *context, NSString *account, NSData **outData) {
    NSDictionary *query = @{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: FaroVaultService,
        (__bridge id)kSecAttrAccount: account,
        (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitOne,
        (__bridge id)kSecReturnData: @YES,
        (__bridge id)kSecUseAuthenticationContext: context,
    };
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status == errSecSuccess) {
        *outData = CFBridgingRelease(result);
    }
    return status;
}

// Legacy vaults retain their original Login Keychain key. Touch ID above is
// the authentication gate, just as in Journal; Keychain separately enforces
// the item's application ACL. Do not suppress its system consent dialog:
// a new signing identity may need authorization to read an older item.
static OSStatus FaroVaultCopyLegacyItem(NSData **outData) {
    SecKeychainRef keychain = NULL;
    OSStatus status = SecKeychainCopyDefault(&keychain);
    if (status != errSecSuccess) {
        return status;
    }

    UInt32 length = 0;
    void *password = NULL;
    // Preserve the process policy instead of leaving it changed globally.
    Boolean previousInteraction = true;
    (void)SecKeychainGetUserInteractionAllowed(&previousInteraction);
    (void)SecKeychainSetUserInteractionAllowed(true);
    status = SecKeychainFindGenericPassword(
        keychain,
        (UInt32)FaroVaultService.length,
        FaroVaultService.UTF8String,
        (UInt32)FaroVaultLegacyAccount.length,
        FaroVaultLegacyAccount.UTF8String,
        &length,
        &password,
        NULL
    );
    (void)SecKeychainSetUserInteractionAllowed(previousInteraction);
    CFRelease(keychain);
    if (status != errSecSuccess) {
        return status;
    }

    *outData = [NSData dataWithBytes:password length:length];
    SecKeychainItemFreeContent(NULL, password);
    return errSecSuccess;
}

static BOOL FaroVaultNormalizeKey(NSData *data, uint8_t output[32]) {
    if (data.length == 32) {
        memcpy(output, data.bytes, 32);
        return YES;
    }
    if (data.length != 64) {
        return NO;
    }
    const unsigned char *bytes = data.bytes;
    for (NSUInteger index = 0; index < 32; index += 1) {
        const unsigned char high = bytes[index * 2];
        const unsigned char low = bytes[index * 2 + 1];
        const int highValue = high >= '0' && high <= '9' ? high - '0'
            : high >= 'a' && high <= 'f' ? high - 'a' + 10
            : high >= 'A' && high <= 'F' ? high - 'A' + 10 : -1;
        const int lowValue = low >= '0' && low <= '9' ? low - '0'
            : low >= 'a' && low <= 'f' ? low - 'a' + 10
            : low >= 'A' && low <= 'F' ? low - 'A' + 10 : -1;
        if (highValue < 0 || lowValue < 0) {
            return NO;
        }
        output[index] = (uint8_t)((highValue << 4) | lowValue);
    }
    return YES;
}

static BOOL FaroVaultStoreBiometricKey(const uint8_t key[32], char **outError) {
    CFErrorRef accessError = NULL;
    SecAccessControlRef accessControl = SecAccessControlCreateWithFlags(
        kCFAllocatorDefault,
        kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        kSecAccessControlBiometryAny,
        &accessError
    );
    if (accessControl == NULL) {
        if (accessError != NULL) {
            NSError *error = CFBridgingRelease(accessError);
            FaroVaultSetError(outError, error.localizedDescription ?: @"No pude preparar Touch ID para FARO Vault.");
        } else {
            FaroVaultSetError(outError, @"No pude preparar Touch ID para FARO Vault.");
        }
        return NO;
    }

    NSData *data = [NSData dataWithBytes:key length:32];
    NSDictionary *query = @{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: FaroVaultService,
        (__bridge id)kSecAttrAccount: FaroVaultBiometricAccount,
        (__bridge id)kSecValueData: data,
        (__bridge id)kSecAttrAccessControl: (__bridge id)accessControl,
    };
    OSStatus status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
    CFRelease(accessControl);
    if (status == errSecSuccess || status == errSecDuplicateItem) {
        return YES;
    }

    CFStringRef description = SecCopyErrorMessageString(status, NULL);
    NSString *message = description == NULL
        ? @"No pude guardar la llave de FARO Vault protegida con Touch ID."
        : CFBridgingRelease(description);
    FaroVaultSetError(outError, message);
    return NO;
}

int faro_vault_copy_biometric_key(uint8_t **outKey, size_t *outLength, char **outError) {
    if (outKey == NULL || outLength == NULL) {
        FaroVaultSetError(outError, @"No pude preparar la llave de FARO Vault.");
        return FaroVaultKeyFailure;
    }
    *outKey = NULL;
    *outLength = 0;
    if (outError != NULL) {
        *outError = NULL;
    }

    @autoreleasepool {
        LAContext *context = nil;
        if (!FaroVaultAuthenticate(&context, outError)) {
            return FaroVaultKeyFailure;
        }

        NSData *stored = nil;
        OSStatus status = FaroVaultCopyItem(context, FaroVaultBiometricAccount, &stored);
        if (status == errSecItemNotFound) {
            // Keep the original encrypted vault and key. Unlocking must not
            // depend on migrating the item to another Keychain backend.
            status = FaroVaultCopyLegacyItem(&stored);
            if (status == errSecItemNotFound) {
                return FaroVaultKeyMissing;
            }
            if (status != errSecSuccess) {
                CFStringRef description = SecCopyErrorMessageString(status, NULL);
                NSString *detail = description ? CFBridgingRelease(description) : @"Acceso no autorizado";
                FaroVaultSetError(outError, [NSString stringWithFormat:@"Touch ID se confirmó, pero el Llavero no permitió abrir la llave de Vault (%d): %@. Tus credenciales siguen intactas.", (int)status, detail]);
                return FaroVaultKeyFailure;
            }
            uint8_t legacyKey[32] = {0};
            if (!FaroVaultNormalizeKey(stored, legacyKey)) {
                FaroVaultSetError(outError, @"La llave existente de FARO Vault no tiene un formato válido.");
                return FaroVaultKeyFailure;
            }
            // Do not copy, replace or delete the legacy key during unlock.
            // It remains protected by its original Keychain ACL; every Vault
            // session still requires the successful Touch ID check above.
            uint8_t *result = malloc(sizeof(legacyKey));
            if (result == NULL) {
                memset(legacyKey, 0, sizeof(legacyKey));
                FaroVaultSetError(outError, @"No pude preparar la llave de FARO Vault.");
                return FaroVaultKeyFailure;
            }
            memcpy(result, legacyKey, sizeof(legacyKey));
            memset(legacyKey, 0, sizeof(legacyKey));
            *outKey = result;
            *outLength = 32;
            return FaroVaultKeySuccess;
        }
        if (status != errSecSuccess) {
            FaroVaultSetError(outError, @"No pude abrir FARO Vault con Touch ID. Inténtalo de nuevo.");
            return FaroVaultKeyFailure;
        }

        uint8_t normalizedKey[32] = {0};
        if (!FaroVaultNormalizeKey(stored, normalizedKey)) {
            FaroVaultSetError(outError, @"La llave protegida de FARO Vault no tiene un formato válido.");
            return FaroVaultKeyFailure;
        }
        uint8_t *result = malloc(sizeof(normalizedKey));
        if (result == NULL) {
            memset(normalizedKey, 0, sizeof(normalizedKey));
            FaroVaultSetError(outError, @"No pude preparar la llave de FARO Vault.");
            return FaroVaultKeyFailure;
        }
        memcpy(result, normalizedKey, sizeof(normalizedKey));
        memset(normalizedKey, 0, sizeof(normalizedKey));
        *outKey = result;
        *outLength = 32;
        return FaroVaultKeySuccess;
    }
}

int faro_vault_store_biometric_key(const uint8_t *key, size_t keyLength, char **outError) {
    if (outError != NULL) {
        *outError = NULL;
    }
    if (key == NULL || keyLength != 32) {
        FaroVaultSetError(outError, @"La llave de FARO Vault no tiene un formato válido.");
        return FaroVaultKeyFailure;
    }
    @autoreleasepool {
        LAContext *context = nil;
        if (!FaroVaultAuthenticate(&context, outError)) {
            return FaroVaultKeyFailure;
        }
        (void)context;
        return FaroVaultStoreBiometricKey(key, outError)
            ? FaroVaultKeySuccess
            : FaroVaultKeyFailure;
    }
}

void faro_vault_remove_biometric_key(void) {
    @autoreleasepool {
        NSDictionary *query = @{
            (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService: FaroVaultService,
            (__bridge id)kSecAttrAccount: FaroVaultBiometricAccount,
        };
        (void)SecItemDelete((__bridge CFDictionaryRef)query);
    }
}

void faro_vault_free_buffer(void *value) {
    if (value != NULL) {
        free(value);
    }
}
