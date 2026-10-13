package cn.suike.slides.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

/** Keeps active, user-requested native HTTP downloads alive while the activity is backgrounded. */
public final class DownloadService extends Service {
    private static final String CHANNEL = "course-downloads";
    @Override public void onCreate() { super.onCreate(); getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(CHANNEL,"课程下载",NotificationManager.IMPORTANCE_LOW)); }
    @Override public int onStartCommand(Intent intent,int flags,int startId) {
        int count = intent == null ? 1 : Math.max(1,intent.getIntExtra("count",1));
        PendingIntent open = PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle("智云助手正在下载")
                .setContentText(count+" 节课程正在处理，可在离线课程中暂停或取消").setOngoing(true).setContentIntent(open).build();
        startForeground(18,notification); return START_NOT_STICKY;
    }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onTimeout(int startId,int foregroundServiceType) { stopSelf(); }
}
