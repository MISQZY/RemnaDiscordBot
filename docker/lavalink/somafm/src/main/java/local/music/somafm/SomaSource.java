package local.music.somafm;

import com.sedmelluq.discord.lavaplayer.container.MediaContainerDescriptor;
import com.sedmelluq.discord.lavaplayer.player.AudioPlayerManager;
import com.sedmelluq.discord.lavaplayer.source.http.HttpAudioSourceManager;
import com.sedmelluq.discord.lavaplayer.track.AudioItem;
import com.sedmelluq.discord.lavaplayer.track.AudioReference;
import com.sedmelluq.discord.lavaplayer.track.AudioTrack;
import com.sedmelluq.discord.lavaplayer.track.AudioTrackInfo;
import java.io.DataInput;
import java.io.IOException;
import java.net.URI;
import org.apache.http.HttpException;
import org.apache.http.conn.routing.HttpRoute;

/** A dedicated source: generic HTTP playback stays disabled. */
public class SomaSource extends HttpAudioSourceManager {
    public SomaSource() {
        configureBuilder(builder -> builder.setRoutePlanner((host, request, context) -> {
            // Applies to every connection, including redirects and playback of saved encoded tracks.
            if (!"https".equals(host.getSchemeName()) || (host.getPort() != -1 && host.getPort() != 443)
                || !host.getHostName().matches("ice[0-9]*\\.somafm\\.com")) {
                throw new HttpException("Only SomaFM stream servers are allowed");
            }
            return new HttpRoute(host, null, true);
        }));
    }

    static boolean allowed(String identifier) {
        try {
            URI uri = URI.create(identifier);
            return "https".equals(uri.getScheme()) && uri.getUserInfo() == null && uri.getPort() == -1
                && uri.getHost() != null && uri.getHost().matches("ice[0-9]*\\.somafm\\.com")
                && uri.getRawPath().matches("/[a-z0-9-]+") && uri.getRawQuery() == null && uri.getRawFragment() == null;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    @Override
    public String getSourceName() { return "somafm"; }

    @Override
    public AudioItem loadItem(AudioPlayerManager manager, AudioReference reference) {
        return allowed(reference.identifier) ? super.loadItem(manager, reference) : null;
    }

    @Override
    protected AudioTrack createTrack(AudioTrackInfo info, MediaContainerDescriptor container) {
        String station = URI.create(info.identifier).getPath().substring(1).replaceFirst("-\\d+-(mp3|aac)$", "");
        AudioTrackInfo live = new AudioTrackInfo("SomaFM · " + station, "SomaFM", Long.MAX_VALUE,
            info.identifier, true, info.identifier);
        return super.createTrack(live, container);
    }

    @Override
    public AudioTrack decodeTrack(AudioTrackInfo info, DataInput input) throws IOException {
        if (!allowed(info.identifier)) throw new IOException("Invalid SomaFM stream");
        return super.decodeTrack(info, input);
    }
}
