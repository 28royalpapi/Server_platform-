# The website calls these native bridge methods by their JavaScript-visible names.
-keep class com.server.caller.ServerSetupWebActivity$Bridge { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
