#import <AppKit/AppKit.h>
#import <AVFoundation/AVFoundation.h>

// Tauri's show() calls makeKeyAndOrderFront on macOS. Passive Mini updates
// deliberately use orderFrontRegardless and never activate NSApplication.
void faro_mini_show_passive(void *handle) {
    NSWindow *window = (__bridge NSWindow *)handle;
    [window setHidesOnDeactivate:NO];
    [window orderFrontRegardless];
}
bool faro_mini_pointer_pressed(void) { return [NSEvent pressedMouseButtons] != 0; }

// Native speech is independent of WebKit autoplay and microphone sessions.
void faro_focus_speak(const char *text) {
    NSString *message = [NSString stringWithUTF8String:text];
    dispatch_async(dispatch_get_main_queue(), ^{
        static AVSpeechSynthesizer *speaker;
        if (!speaker) speaker = [[AVSpeechSynthesizer alloc] init];
        AVSpeechUtterance *utterance = [AVSpeechUtterance speechUtteranceWithString:message];
        utterance.voice = [AVSpeechSynthesisVoice voiceWithLanguage:@"es-MX"]
            ?: [AVSpeechSynthesisVoice voiceWithLanguage:@"es-ES"];
        // Play the alarm first so the short spoken notice remains intelligible.
        NSSound *bell = [[NSSound soundNamed:@"Glass"] copy];
        NSTimeInterval delay = 0.5;
        if (bell && [bell play]) {
            delay = bell.duration + 0.15;
        } else {
            NSBeep();
        }
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            // Retain the sound until playback has finished.
            (void)bell;
            [speaker speakUtterance:utterance];
        });
    });
}
