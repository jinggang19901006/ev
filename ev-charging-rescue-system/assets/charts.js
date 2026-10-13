(function() {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();

  // --- Chart 1: 三阶段盈利测算 ---
  var chart1 = echarts.init(document.getElementById('chart-profit'), null, { renderer: 'svg' });
  chart1.setOption({
    animation: false,
    tooltip: {
      trigger: 'axis',
      appendToBody: true,
      axisPointer: { type: 'shadow' },
      formatter: function(params) {
        var result = params[0].axisValue + '<br/>';
        params.forEach(function(p) {
          result += p.marker + p.seriesName + ': ' + p.value + ' 元<br/>';
        });
        return result;
      }
    },
    legend: {
      data: ['月营收', '月利润'],
      textStyle: { color: ink, fontSize: 13 },
      top: 0
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: '15%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: ['阶段一\n(单台车)', '阶段二\n(2-3台车)', '阶段三\n(平台化)'],
      axisLabel: { color: ink, fontSize: 12, lineHeight: 16 },
      axisLine: { lineStyle: { color: rule } }
    },
    yAxis: {
      type: 'value',
      name: '金额(元)',
      nameTextStyle: { color: muted, fontSize: 12 },
      axisLabel: { color: muted, fontSize: 12 },
      splitLine: { lineStyle: { color: rule, type: 'dashed' } }
    },
    series: [
      {
        name: '月营收',
        type: 'bar',
        barWidth: '30%',
        itemStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: accent },
              { offset: 1, color: accent + '88' }
            ]
          },
          borderRadius: [4, 4, 0, 0]
        },
        data: [9000, 27000, 80000]
      },
      {
        name: '月利润',
        type: 'bar',
        barWidth: '30%',
        itemStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: accent2 },
              { offset: 1, color: accent2 + '88' }
            ]
          },
          borderRadius: [4, 4, 0, 0]
        },
        data: [6000, 16000, 40000]
      }
    ]
  });
  window.addEventListener('resize', function() { chart1.resize(); });

  // --- Chart 2: 订单来源渠道占比 ---
  var chart2 = echarts.init(document.getElementById('chart-channels'), null, { renderer: 'svg' });
  chart2.setOption({
    animation: false,
    tooltip: {
      trigger: 'item',
      appendToBody: true,
      formatter: '{b}: {c}%'
    },
    legend: {
      orient: 'vertical',
      right: '5%',
      top: 'center',
      textStyle: { color: ink, fontSize: 12 }
    },
    series: [
      {
        name: '订单来源',
        type: 'pie',
        radius: ['45%', '70%'],
        center: ['35%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 4,
          borderColor: bg2,
          borderWidth: 2
        },
        label: { show: false },
        emphasis: {
          label: { show: true, fontSize: 14, fontWeight: 'bold', color: ink }
        },
        labelLine: { show: false },
        data: [
          { value: 30, name: '抖音/快手同城', itemStyle: { color: accent } },
          { value: 25, name: '高德/百度地图', itemStyle: { color: accent2 } },
          { value: 20, name: '4S店/维修店转介', itemStyle: { color: '#6366f1' } },
          { value: 15, name: '网约车/车队合作', itemStyle: { color: muted } },
          { value: 10, name: '朋友圈/熟人介绍', itemStyle: { color: accent + '66' } }
        ]
      }
    ]
  });
  window.addEventListener('resize', function() { chart2.resize(); });

  // --- Chart 3: 用户端核心功能使用频率 ---
  var chart3 = echarts.init(document.getElementById('chart-features'), null, { renderer: 'svg' });
  chart3.setOption({
    animation: false,
    tooltip: {
      trigger: 'axis',
      appendToBody: true,
      axisPointer: { type: 'shadow' }
    },
    grid: {
      left: '3%',
      right: '10%',
      bottom: '3%',
      top: '3%',
      containLabel: true
    },
    xAxis: {
      type: 'value',
      axisLabel: { color: muted, fontSize: 12 },
      splitLine: { lineStyle: { color: rule, type: 'dashed' } }
    },
    yAxis: {
      type: 'category',
      data: ['在线客服', '订单评价', '充电进度查看', '救援员位置追踪', '一键下单救援', '实时预估价格'],
      axisLabel: { color: ink, fontSize: 12 },
      axisLine: { lineStyle: { color: rule } }
    },
    series: [
      {
        type: 'bar',
        barWidth: '50%',
        itemStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 1, y2: 0,
            colorStops: [
              { offset: 0, color: accent + '66' },
              { offset: 1, color: accent }
            ]
          },
          borderRadius: [0, 4, 4, 0]
        },
        data: [45, 55, 70, 85, 95, 90]
      }
    ]
  });
  window.addEventListener('resize', function() { chart3.resize(); });
})();
