package com.hanlinsoftware.heapgame.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.content.Intent;
import android.util.Log;

import com.google.android.gms.games.PlayGames;
import com.google.android.gms.games.GamesSignInClient;
import com.google.android.gms.games.Player;
import com.google.android.gms.games.AchievementsClient;
import com.google.android.gms.games.LeaderboardsClient;
import com.google.android.gms.games.SnapshotsClient;
import com.google.android.gms.games.snapshot.Snapshot;
import com.google.android.gms.games.snapshot.SnapshotMetadataChange;

@CapacitorPlugin(name = "PlayGames")
public class PlayGamesPlugin extends Plugin {

    // ── Sign-in ──────────────────────────────────────────────────────────────

    private static final String TAG = "PlayGamesPlugin";

    @PluginMethod
    public void signIn(PluginCall call) {
        Log.d(TAG, "signIn() called");
        GamesSignInClient signInClient = PlayGames.getGamesSignInClient(getActivity());
        signInClient.isAuthenticated().addOnCompleteListener(authTask -> {
            if (!authTask.isSuccessful()) {
                String err = authTask.getException() != null ? authTask.getException().getMessage() : "unknown";
                Log.e(TAG, "isAuthenticated() failed: " + err);
                call.reject("Failed to check authentication status");
                return;
            }
            boolean isAuthenticated = authTask.getResult() != null
                && authTask.getResult().isAuthenticated();
            Log.d(TAG, "isAuthenticated() result: " + isAuthenticated);

            if (isAuthenticated) {
                fetchAndResolvePlayer(call);
            } else {
                Log.d(TAG, "Not authenticated, calling signIn()");
                signInClient.signIn().addOnCompleteListener(signInTask -> {
                    boolean authenticated = signInTask.isSuccessful()
                        && signInTask.getResult() != null
                        && signInTask.getResult().isAuthenticated();
                    if (authenticated) {
                        Log.d(TAG, "signIn() succeeded and authenticated");
                        fetchAndResolvePlayer(call);
                    } else {
                        String err = signInTask.getException() != null ? signInTask.getException().getMessage() : "not authenticated";
                        Log.e(TAG, "signIn() failed or not authenticated: " + err);
                        call.reject("GPGS sign-in failed");
                    }
                });
            }
        });
    }

    private void fetchAndResolvePlayer(PluginCall call) {
        Log.d(TAG, "fetchAndResolvePlayer() called");
        PlayGames.getPlayersClient(getActivity()).getCurrentPlayer()
            .addOnCompleteListener(playerTask -> {
                if (playerTask.isSuccessful() && playerTask.getResult() != null) {
                    Player player = playerTask.getResult();
                    Log.d(TAG, "Got player: " + player.getDisplayName() + " id=" + player.getPlayerId());
                    JSObject result = new JSObject();
                    result.put("playerId", player.getPlayerId());
                    result.put("displayName", player.getDisplayName());
                    call.resolve(result);
                } else {
                    String msg = "Failed to get player info";
                    if (playerTask.getException() != null) msg += ": " + playerTask.getException().getMessage();
                    Log.e(TAG, msg);
                    call.reject(msg);
                }
            });
    }

    // ── Achievements ─────────────────────────────────────────────────────────

    @PluginMethod
    public void unlockAchievement(PluginCall call) {
        String achievementId = call.getString("achievementId");
        if (achievementId == null || achievementId.isEmpty()) {
            call.reject("Missing achievementId");
            return;
        }
        PlayGames.getAchievementsClient(getActivity()).unlock(achievementId);
        call.resolve();
    }

    @PluginMethod
    public void incrementAchievement(PluginCall call) {
        String achievementId = call.getString("achievementId");
        Integer steps = call.getInt("steps", 1);
        if (achievementId == null || achievementId.isEmpty()) {
            call.reject("Missing achievementId");
            return;
        }
        PlayGames.getAchievementsClient(getActivity()).increment(achievementId, steps);
        call.resolve();
    }

    // ── Leaderboards ──────────────────────────────────────────────────────────

    @PluginMethod
    public void submitScore(PluginCall call) {
        String leaderboardId = call.getString("leaderboardId");
        Long score = call.getLong("score", 0L);
        if (leaderboardId == null || leaderboardId.isEmpty()) {
            call.reject("Missing leaderboardId");
            return;
        }
        PlayGames.getLeaderboardsClient(getActivity()).submitScore(leaderboardId, score);
        call.resolve();
    }

    // ── Profile ───────────────────────────────────────────────────────────────

    @PluginMethod
    public void showPlayerProfile(PluginCall call) {
        Log.d(TAG, "showPlayerProfile() called");
        Intent intent = getActivity().getPackageManager()
            .getLaunchIntentForPackage("com.google.android.play.games");
        if (intent != null) {
            Log.d(TAG, "Launching Play Games app");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            call.resolve();
        } else {
            Log.d(TAG, "Play Games app not found, showing achievements overlay");
            PlayGames.getAchievementsClient(getActivity())
                .getAchievementsIntent()
                .addOnSuccessListener(achievementsIntent -> {
                    getActivity().startActivityForResult(achievementsIntent, 9001);
                    call.resolve();
                })
                .addOnFailureListener(e -> {
                    Log.e(TAG, "Achievements overlay failed: " + e.getMessage());
                    call.resolve();
                });
        }
    }

    // ── Cloud Saves (Snapshots) ────────────────────────────────────────────────

    private static final String SNAPSHOT_NAME = "heap_save";

    @PluginMethod
    public void saveSnapshot(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("Missing data");
            return;
        }

        SnapshotsClient snapshotsClient = PlayGames.getSnapshotsClient(getActivity());
        byte[] bytes = data.getBytes(java.nio.charset.StandardCharsets.UTF_8);

        snapshotsClient.open(SNAPSHOT_NAME, true).addOnCompleteListener(openTask -> {
            if (!openTask.isSuccessful() || openTask.getResult() == null) {
                call.reject("Snapshot open failed");
                return;
            }
            Snapshot snapshot = openTask.getResult().getData();
            if (snapshot == null) {
                call.reject("Snapshot data null after open");
                return;
            }
            snapshot.getSnapshotContents().writeBytes(bytes);

            SnapshotMetadataChange metadataChange = new SnapshotMetadataChange.Builder()
                .setDescription("Heap save data")
                .build();

            snapshotsClient.commitAndClose(snapshot, metadataChange)
                .addOnCompleteListener(commitTask -> {
                    if (commitTask.isSuccessful()) {
                        call.resolve();
                    } else {
                        call.reject("Snapshot commit failed");
                    }
                });
        });
    }

    @PluginMethod
    public void loadSnapshot(PluginCall call) {
        SnapshotsClient snapshotsClient = PlayGames.getSnapshotsClient(getActivity());

        snapshotsClient.open(SNAPSHOT_NAME, true).addOnCompleteListener(openTask -> {
            if (!openTask.isSuccessful() || openTask.getResult() == null) {
                JSObject result = new JSObject();
                result.put("data", (Object) null);
                call.resolve(result);
                return;
            }

            // Handle conflict: pick the snapshot with the larger raw size (proxy for more data).
            SnapshotsClient.DataOrConflict<Snapshot> dataOrConflict = openTask.getResult();
            if (dataOrConflict.isConflict()) {
                SnapshotsClient.SnapshotConflict conflict = dataOrConflict.getConflict();
                Snapshot base    = conflict.getSnapshot();
                Snapshot remote  = conflict.getConflictingSnapshot();
                // Conflict resolution is done in TypeScript (mergeCloudSave).
                // Here we just pick whichever snapshot has more bytes as the "winner"
                // and close the other — TypeScript will merge the two after loading.
                try {
                    byte[] baseBytes   = base.getSnapshotContents().readFully();
                    byte[] remoteBytes = remote.getSnapshotContents().readFully();
                    Snapshot winner = baseBytes.length >= remoteBytes.length ? base : remote;
                    snapshotsClient.resolveConflict(conflict.getConflictId(), winner)
                        .addOnCompleteListener(resolveTask -> {
                            if (!resolveTask.isSuccessful()) {
                                call.reject("Snapshot conflict resolution failed");
                                return;
                            }
                            // After resolution, re-open to read the resolved state.
                            snapshotsClient.open(SNAPSHOT_NAME, false).addOnCompleteListener(reopenTask -> {
                                readAndResolveSnapshot(reopenTask, snapshotsClient, call);
                            });
                        });
                } catch (java.io.IOException e) {
                    call.reject("Failed to read snapshot contents during conflict resolution");
                }
                return;
            }

            readAndResolveSnapshot(openTask, snapshotsClient, call);
        });
    }

    private void readAndResolveSnapshot(
        com.google.android.gms.tasks.Task<SnapshotsClient.DataOrConflict<Snapshot>> task,
        SnapshotsClient snapshotsClient,
        PluginCall call
    ) {
        if (!task.isSuccessful() || task.getResult() == null || task.getResult().getData() == null) {
            JSObject result = new JSObject();
            result.put("data", (Object) null);
            call.resolve(result);
            return;
        }
        Snapshot snapshot = task.getResult().getData();
        try {
            byte[] bytes = snapshot.getSnapshotContents().readFully();
            snapshotsClient.discardAndClose(snapshot);

            JSObject result = new JSObject();
            result.put("data", new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (java.io.IOException e) {
            snapshotsClient.discardAndClose(snapshot);
            call.reject("Failed to read snapshot contents");
        }
    }
}
