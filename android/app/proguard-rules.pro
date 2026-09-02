# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

##---------------------------------------------------------------------------
## R8 full mode: restore member specs the AndroidX consumer rules are missing
##
## Several AndroidX libraries ship consumer ProGuard rules written for
## ProGuard's semantics, where a memberless `-keep class X` also retained the
## default constructor. R8 full mode keeps only the class *name*. The class then
## still resolves through Class.forName(), but has no <init>, so newInstance()
## throws InstantiationException at runtime.
##
## This is invisible to the build -- `assembleRelease` succeeds and the APK is
## well-formed -- so it only shows up when the code actually runs. Verify with
## scripts/check-r8-keeps.sh, which CI runs against every release build.
##
## These rules add back exactly the member specs the upstream rules omit. They
## are keep rules, so the only cost is retaining a handful of methods.
##---------------------------------------------------------------------------

# room-runtime 2.2.5 (transitive: play-services-ads-api -> work-runtime 2.7.0)
# ships `-keep class * extends androidx.room.RoomDatabase` with no member spec.
# Room resolves the generated <Database>_Impl by name and calls newInstance(),
# so stripping its constructor is fatal. This crashed V0.2.29 on every launch --
# WorkManagerInitializer runs from androidx.startup's ContentProvider, i.e.
# before Application.onCreate, so the process died before MainActivity started:
#
#   java.lang.RuntimeException: Unable to get provider
#       androidx.startup.InitializationProvider
#   Caused by: java.lang.RuntimeException: Failed to create an instance of
#       androidx.work.impl.WorkDatabase
#
# Room still ships the memberless rule as of 2.6.1, so this is not fixed by
# moving to a newer Room -- the member spec has to come from us.
-keep class * extends androidx.room.RoomDatabase { <init>(); }

# work-runtime 2.7.0 ships `-keep class * extends androidx.work.InputMerger`,
# also memberless. WorkManager instantiates the merger reflectively in
# InputMerger.fromClassName() whenever a work continuation combines inputs
# (CombineContinuationsWorker), which the AdMob offline-buffering chain uses.
# Verified stripped in the 0.2.29 build: OverwritingInputMerger had 0 methods.
#
# Its sibling rule for Workers needs nothing from us -- work-runtime separately
# ships `-keep public class * extends ListenableWorker { public <init>(...); }`,
# and the Worker subclasses were confirmed intact in the same build.
-keep class * extends androidx.work.InputMerger { <init>(); }
