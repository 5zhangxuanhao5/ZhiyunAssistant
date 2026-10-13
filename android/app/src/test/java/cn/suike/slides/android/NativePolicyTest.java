package cn.suike.slides.android;

import org.junit.Test;
import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import static org.junit.Assert.*;

/** Tests real network/file policy, including adversarial origins and canonical symlinks. */
public class NativePolicyTest {
    @Test public void allowlistedHttpsOnly() throws Exception {
        assertEquals("classroom.zju.edu.cn",NativePolicy.https("https://classroom.zju.edu.cn/a",false).getHost());
        assertEquals("api.deepseek.com",NativePolicy.https("https://api.deepseek.com/chat/completions",false).getHost());
        assertEquals("video.chinamcloud.com",NativePolicy.https("https://video.chinamcloud.com/a",true).getHost());
        for (String invalid : new String[]{"http://classroom.zju.edu.cn/a","https://classroom.zju.edu.cn.evil.test/a","https://evilzju.edu.cn/a","https://user@classroom.zju.edu.cn/a","https://classroom.zju.edu.cn:8443/a","https://classroom.zju.edu.cn/a#x","file:///data/user/0/a","https://127.0.0.1/a"})
            assertThrows(invalid,IOException.class,() -> NativePolicy.https(invalid,false));
        assertThrows(IOException.class,() -> NativePolicy.https("https://api.deepseek.com/a",true));
    }
    @Test public void canonicalSandboxCannotEscape() throws Exception {
        Path base = Files.createTempDirectory("zhiyun-policy");
        File files = Files.createDirectories(base.resolve("files")).toFile(), cache = Files.createDirectories(base.resolve("cache")).toFile();
        assertEquals(new File(files,"note.txt").getCanonicalFile(),NativePolicy.sandbox(new File(files,"note.txt").toString(),files,cache));
        assertThrows(IOException.class,() -> NativePolicy.sandbox("relative.txt",files,cache));
        assertThrows(IOException.class,() -> NativePolicy.sandbox(new File(files,"../outside.txt").toString(),files,cache));
        assertThrows(IOException.class,() -> NativePolicy.sandbox(base.resolve("files2/secret.txt").toString(),files,cache));
        Path outside = Files.createDirectories(base.resolve("outside"));
        Files.createSymbolicLink(files.toPath().resolve("link"),outside);
        assertThrows(IOException.class,() -> NativePolicy.sandbox(files.toPath().resolve("link/secret.txt").toString(),files,cache));
    }
    @Test public void strictRangesAllowVideoSeeking() throws Exception {
        assertArrayEquals(new long[]{0,99},NativePolicy.range(null,100));
        assertArrayEquals(new long[]{20,99},NativePolicy.range("bytes=20-",100));
        assertArrayEquals(new long[]{90,99},NativePolicy.range("bytes=-10",100));
        assertArrayEquals(new long[]{0,99},NativePolicy.range("bytes=-1000",100));
        assertArrayEquals(new long[]{20,99},NativePolicy.range("bytes=20-1000",100));
        for (String invalid : new String[]{"bytes=100-","bytes=-0","bytes=4-2","bytes=-1-4","bytes=0-5,10-15","items=0-1","bytes=NaN-4"})
            assertThrows(invalid,IOException.class,() -> NativePolicy.range(invalid,100));
        assertThrows(IOException.class,() -> NativePolicy.range("bytes=0-",0));
    }
    @Test public void campusDetectionIsBounded() {
        assertTrue(NativePolicy.campus(URI.create("https://zju.edu.cn/a")));
        assertTrue(NativePolicy.campus(URI.create("https://Classroom.ZJU.EDU.CN/a")));
        assertFalse(NativePolicy.campus(URI.create("https://classroom.zju.edu.cn.evil.test/a")));
        assertEquals("https://classroom.zju.edu.cn",NativePolicy.origin(URI.create("https://Classroom.ZJU.EDU.CN:443/a")));
    }
    @Test public void credentialsStayWithTheCorrectOrigin() {
        URI campus = URI.create("https://classroom.zju.edu.cn/a"), cdn = URI.create("https://video.chinamcloud.com/a"), ai = URI.create("https://api.deepseek.com/chat/completions");
        assertTrue(NativePolicy.credentialHeaderAllowed("Cookie",campus));
        assertTrue(NativePolicy.credentialHeaderAllowed("Authorization",campus));
        assertTrue(NativePolicy.credentialHeaderAllowed("Authorization",ai));
        assertFalse(NativePolicy.credentialHeaderAllowed("Cookie",ai));
        assertFalse(NativePolicy.credentialHeaderAllowed("Authorization",cdn));
        assertFalse(NativePolicy.credentialHeaderAllowed("Cookie",cdn));
        assertFalse(NativePolicy.credentialsMustBeStripped(campus,URI.create("https://classroom.zju.edu.cn/b")));
        assertTrue(NativePolicy.credentialsMustBeStripped(campus,URI.create("https://zjuam.zju.edu.cn/b")));
        assertTrue(NativePolicy.credentialsMustBeStripped(campus,cdn));
        assertTrue(NativePolicy.credentialsMustBeStripped(ai,campus));
    }
    @Test public void explicitExternalLinksHaveTheirOwnNarrowPolicy()throws Exception{
        assertEquals("platform.deepseek.com",NativePolicy.externalHttps("https://platform.deepseek.com/api_keys").getHost());
        assertEquals("github.com",NativePolicy.externalHttps("https://github.com/example/zhiyun/releases").getHost());
        assertEquals("classroom.zju.edu.cn",NativePolicy.externalHttps("https://classroom.zju.edu.cn/").getHost());
        for(String invalid:new String[]{"https://platform.deepseek.com.evil.test/","https://github.com.evil.test/","http://github.com/","https://user@github.com/","javascript:alert(1)","https://unrelated.example/"})
            assertThrows(IOException.class,()->NativePolicy.externalHttps(invalid));
        assertThrows(IOException.class,()->NativePolicy.https("https://platform.deepseek.com/api_keys",false));
        assertThrows(IOException.class,()->NativePolicy.https("https://github.com/example/zhiyun",true));
    }
}
