package cn.suike.slides.android;
import org.junit.Test;
import java.io.ByteArrayInputStream;
import static org.junit.Assert.*;
public class WebViewRangeInputStreamTest {
    @Test public void seekingHugePrefixCostsNoPayloadBytes()throws Exception{
        WebViewRangeInputStream stream=new WebViewRangeInputStream(new ByteArrayInputStream(new byte[]{7,8,9}),1_900_000_000L,3);
        assertEquals(1_900_000_003,stream.available());assertEquals(1_900_000_000L,stream.skip(1_900_000_000L));
        assertEquals(3,stream.available());assertEquals(7,stream.read());assertEquals(2,stream.available());assertEquals(8,stream.read());assertEquals(9,stream.read());assertEquals(-1,stream.read());
    }
    @Test public void rangeBoundsDoNotExposeFollowingBytes()throws Exception{
        WebViewRangeInputStream stream=new WebViewRangeInputStream(new ByteArrayInputStream(new byte[]{2,3,4,5}),2,2);assertEquals(2,stream.skip(2));
        byte[] result=new byte[10];assertEquals(2,stream.read(result));assertEquals(2,result[0]);assertEquals(3,result[1]);assertEquals(-1,stream.read(result));
    }
    @Test public void suffixSeekPreservesLastBytes()throws Exception{
        WebViewRangeInputStream stream=new WebViewRangeInputStream(new ByteArrayInputStream(new byte[]{97,98,99}),97,3);
        assertEquals(100,stream.available());assertEquals(97,stream.skip(97));assertEquals(97,stream.read());assertEquals(98,stream.read());assertEquals(99,stream.read());
    }
    @Test public void greaterThanTwoGiBDoesNotTruncateTheSeekOrigin()throws Exception{
        WebViewRangeInputStream stream=new WebViewRangeInputStream(new ByteArrayInputStream(new byte[]{12,13,14}),3_221_225_472L,3);
        assertEquals(0,stream.available());assertEquals(Integer.MAX_VALUE,stream.skip(3_221_225_472L));
        assertEquals(1_073_741_825L,stream.skip(1_073_741_825L));
        assertEquals(3,stream.available());assertEquals(12,stream.read());assertEquals(13,stream.read());assertEquals(14,stream.read());assertEquals(-1,stream.read());
    }
}
